"""Optional external feeds (YouTube, Substack) as a committed, validated snapshot.

The snapshot in ``content/feeds.json`` is refreshed deliberately with
``python -m sitegen refresh-feeds``. The build never touches the network: a
missing, stale or invalid snapshot simply omits the feed section, which is the
one thing a personal site must not fail on.
"""

from __future__ import annotations

import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlsplit

from .content import CONTROL_RE
from .errors import ContentError

SCHEMA = 1
MAX_ITEMS = 12
ALLOWED_HOSTS = {
    "youtube": ("www.youtube.com", "youtube.com"),
    "substack": ("hankmarquardt.substack.com",),
}
SOURCES = {
    "youtube": {
        "label": "Earwurmz of Whimsy",
        "url": "https://www.youtube.com/channel/UC_D3lgvy2XWLEZ1Uw4IU9Rg",
        "feed": "https://www.youtube.com/feeds/videos.xml?channel_id=UC_D3lgvy2XWLEZ1Uw4IU9Rg",
    },
    "substack": {
        "label": "Hank Marquardt on Substack",
        "url": "https://hankmarquardt.substack.com",
        "feed": "https://hankmarquardt.substack.com/feed",
    },
}
USER_AGENT = "hankmarquardt.com feed refresh (+https://hankmarquardt.com)"


@dataclass(frozen=True)
class FeedItem:
    title: str
    url: str
    published: date | None


@dataclass(frozen=True)
class Feed:
    key: str
    label: str
    url: str
    items: tuple[FeedItem, ...]


@dataclass(frozen=True)
class FeedSnapshot:
    refreshed: date | None = None
    feeds: dict[str, Feed] = field(default_factory=dict)
    problems: tuple[str, ...] = ()

    def get(self, key: str, limit: int = 0) -> Feed | None:
        feed = self.feeds.get(key)
        if feed is None or not feed.items:
            return None
        if limit:
            return Feed(
                key=feed.key, label=feed.label, url=feed.url, items=feed.items[:limit]
            )
        return feed


def _valid_public_url(value: str, host: str) -> bool:
    if not isinstance(value, str) or len(value) > 500 or CONTROL_RE.search(value):
        return False
    try:
        parts = urlsplit(value)
    except ValueError:
        return False
    return (
        parts.scheme == "https"
        and (parts.hostname or "").lower() == host
        and not parts.username
        and not parts.password
    )


def _clean_text(value: str, *, maximum: int = 200) -> str:
    text = re.sub(r"\s+", " ", value or "").strip()
    text = CONTROL_RE.sub("", text)
    return text[:maximum]


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).date()



def load_snapshot(path: Path) -> FeedSnapshot:
    """Read the committed snapshot. Never raises: bad data only drops a section."""

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return FeedSnapshot(problems=("feeds snapshot is missing",))
    except (OSError, json.JSONDecodeError) as error:
        return FeedSnapshot(problems=(f"feeds snapshot is unreadable: {error}",))

    if not isinstance(raw, dict) or raw.get("schema") != SCHEMA:
        return FeedSnapshot(problems=("feeds snapshot has an unexpected schema",))

    problems: list[str] = []
    try:
        refreshed = date.fromisoformat(str(raw.get("refreshed")))
    except ValueError:
        refreshed = None
        problems.append("feeds snapshot has no valid refresh date")

    sources = raw.get("sources")
    if not isinstance(sources, dict):
        return FeedSnapshot(
            refreshed=refreshed, problems=tuple(problems + ["feeds snapshot has no sources"])
        )

    feeds: dict[str, Feed] = {}
    for key, config in SOURCES.items():
        source = sources.get(key)
        if not isinstance(source, dict):
            problems.append(f"{key}: missing from snapshot")
            continue
        problems.extend(_validate_source(key, config, source, feeds))
    return FeedSnapshot(refreshed=refreshed, feeds=feeds, problems=tuple(problems))


def _validate_source(
    key: str, config: dict[str, str], source: dict[str, object], feeds: dict[str, Feed]
) -> list[str]:
    problems: list[str] = []
    label = source.get("label")
    url = source.get("url")
    items = source.get("items")
    expected_host = urlsplit(config["url"]).hostname or ""
    if not isinstance(label, str) or not label.strip():
        return [f"{key}: label is missing"]
    if not isinstance(url, str) or not _valid_public_url(url, expected_host):
        return [f"{key}: public URL is not an approved https URL"]
    if not isinstance(items, list):
        return [f"{key}: items must be a list"]

    allowed = ALLOWED_HOSTS[key]
    parsed: list[FeedItem] = []
    for item in items[:MAX_ITEMS]:
        if not isinstance(item, dict):
            problems.append(f"{key}: an item is not an object")
            continue
        title = _clean_text(str(item.get("title", "")))
        item_url = item.get("url")
        if not title:
            problems.append(f"{key}: an item has no title")
            continue
        if not isinstance(item_url, str) or not any(
            _valid_public_url(item_url, host) for host in allowed
        ):
            problems.append(f"{key}: an item URL is not on an approved host")
            continue
        published = _parse_date(item.get("published")) if item.get("published") else None
        parsed.append(FeedItem(title=title, url=item_url, published=published))
    feeds[key] = Feed(key=key, label=_clean_text(label, maximum=80), url=url, items=tuple(parsed))
    return problems


def _reject_doctype(payload: bytes) -> None:
    head = payload[:4096].upper()
    if b"<!DOCTYPE" in head or b"<!ENTITY" in head:
        raise ContentError("refusing an XML document with a doctype or entity declaration")


def _fetch(url: str, *, timeout: float = 15.0) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/atom+xml, application/rss+xml, application/xml",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise ContentError(f"{url}: unexpected status {response.status}")
        payload = response.read(2_000_000)
    _reject_doctype(payload)
    return payload


def parse_youtube(payload: bytes) -> dict[str, object]:
    _reject_doctype(payload)
    root = ET.fromstring(payload)
    ns = {
        "atom": "http://www.w3.org/2005/Atom",
        "yt": "http://www.youtube.com/xml/schemas/2015",
    }
    label = _clean_text(root.findtext("atom:title", default="", namespaces=ns), maximum=80)
    items: list[dict[str, str]] = []
    for entry in root.findall("atom:entry", ns):
        video_id = entry.findtext("yt:videoId", default="", namespaces=ns).strip()
        title = _clean_text(entry.findtext("atom:title", default="", namespaces=ns))
        if not re.fullmatch(r"[A-Za-z0-9_-]{6,20}", video_id) or not title:
            continue
        items.append(
            {
                "title": title,
                "url": f"https://www.youtube.com/watch?v={video_id}",
                "published": (
                    parsed.isoformat() if (parsed := _parse_date(
                        entry.findtext("atom:published", default="", namespaces=ns)
                    )) else ""
                ),
            }
        )
    return {
        "label": label or SOURCES["youtube"]["label"],
        "url": SOURCES["youtube"]["url"],
        "items": items[:MAX_ITEMS],
    }


def parse_substack(payload: bytes) -> dict[str, object]:
    _reject_doctype(payload)
    root = ET.fromstring(payload)
    channel = root.find("channel")
    if channel is None:
        raise ContentError("substack feed has no channel")
    label = _clean_text(channel.findtext("title") or "", maximum=80)
    items: list[dict[str, str]] = []
    for item in channel.findall("item"):
        title = _clean_text(item.findtext("title") or "")
        url = (item.findtext("link") or "").strip()
        if title and _valid_public_url(url, "hankmarquardt.substack.com"):
            items.append(
                {
                    "title": title,
                    "url": url,
                    "published": (
                        parsed.isoformat()
                        if (parsed := _parse_date(item.findtext("pubDate") or ""))
                        else ""
                    ),
                }
            )
    return {
        "label": label or SOURCES["substack"]["label"],
        "url": SOURCES["substack"]["url"],
        "items": items[:MAX_ITEMS],
    }



def refresh_snapshot(
    path: Path,
    *,
    fetch: Callable[[str], bytes] = _fetch,
    today: date | None = None,
) -> tuple[list[str], list[str]]:
    """Fetch both feeds, keeping the previous entry for any source that fails.

    Returns ``(refreshed_keys, failures)``. A failure never removes a section
    that was already committed: the snapshot is the fallback.
    """

    existing = load_snapshot(path)
    sources: dict[str, object] = {
        key: _feed_to_json(feed) for key, feed in existing.feeds.items()
    }

    refreshed: list[str] = []
    failures: list[str] = []
    for key in SOURCES:
        try:
            payload = fetch(SOURCES[key]["feed"])
            parsed = parse_youtube(payload) if key == "youtube" else parse_substack(payload)
        except Exception as error:  # noqa: BLE001 - report, never publish a broken feed
            failures.append(f"{key}: {type(error).__name__}: {error}")
            continue
        sources[key] = parsed
        refreshed.append(key)

    document = {
        "schema": SCHEMA,
        "refreshed": (today or datetime.now(UTC).date()).isoformat(),
        "sources": {key: sources[key] for key in SOURCES if key in sources},
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return refreshed, failures


def _feed_to_json(feed: Feed) -> dict[str, object]:
    return {
        "label": feed.label,
        "url": feed.url,
        "items": [
            {
                "title": item.title,
                "url": item.url,
                "published": item.published.isoformat() if item.published else "",
            }
            for item in feed.items
        ],
    }
