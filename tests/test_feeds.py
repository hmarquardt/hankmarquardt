"""Feed snapshot validation, parsing and failure behaviour."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from conftest import DEFAULT_FEEDS

from sitegen.feeds import load_snapshot, parse_substack, parse_youtube, refresh_snapshot

YOUTUBE_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <title>Earwurmz of Whimsy</title>
  <entry>
    <yt:videoId>abcdefghijk</yt:videoId>
    <title>Video &amp; One</title>
    <published>2026-10-26T01:11:42+00:00</published>
  </entry>
  <entry>
    <yt:videoId>bad id</yt:videoId>
    <title>Rejected</title>
  </entry>
</feed>
"""

SUBSTACK_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Hank Marquardt</title>
  <item>
    <title>Post &amp; One</title>
    <link>https://hankmarquardt.substack.com/p/post-one</link>
    <pubDate>Thu, 01 Oct 2026 18:35:13 GMT</pubDate>
  </item>
  <item>
    <title>Elsewhere</title>
    <link>https://evil.example.com/p/elsewhere</link>
  </item>
</channel></rss>
"""


def test_parse_youtube_extracts_only_valid_entries() -> None:
    parsed = parse_youtube(YOUTUBE_XML)
    assert parsed["label"] == "Earwurmz of Whimsy"
    assert parsed["items"] == [
        {
            "title": "Video & One",
            "url": "https://www.youtube.com/watch?v=abcdefghijk",
            "published": "2026-10-26",
        }
    ]


def test_parse_substack_rejects_foreign_hosts() -> None:
    parsed = parse_substack(SUBSTACK_XML)
    assert parsed["label"] == "Hank Marquardt"
    assert len(parsed["items"]) == 1
    assert parsed["items"][0]["url"] == "https://hankmarquardt.substack.com/p/post-one"
    assert parsed["items"][0]["published"] == "2026-10-01"


def test_snapshot_is_validated(tmp_path: Path) -> None:
    path = tmp_path / "feeds.json"
    path.write_text(json.dumps(DEFAULT_FEEDS), encoding="utf-8")
    snapshot = load_snapshot(path)
    assert snapshot.problems == ()
    assert snapshot.get("youtube").items[0].published == date(2026, 10, 26)
    assert snapshot.get("substack", limit=0) is not None


def test_snapshot_rejects_foreign_item_hosts(tmp_path: Path) -> None:
    data = json.loads(json.dumps(DEFAULT_FEEDS))
    data["sources"]["youtube"]["items"][0]["url"] = "https://evil.example.com/watch?v=x"
    path = tmp_path / "feeds.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    snapshot = load_snapshot(path)
    assert snapshot.get("youtube") is None
    assert any("approved host" in problem for problem in snapshot.problems)


def test_snapshot_rejects_javascript_urls(tmp_path: Path) -> None:
    data = json.loads(json.dumps(DEFAULT_FEEDS))
    data["sources"]["substack"]["items"][0]["url"] = "javascript:alert(1)"
    path = tmp_path / "feeds.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    snapshot = load_snapshot(path)
    assert snapshot.get("substack") is None


def test_missing_snapshot_is_reported_not_raised(tmp_path: Path) -> None:
    snapshot = load_snapshot(tmp_path / "nope.json")
    assert snapshot.feeds == {}
    assert snapshot.problems


def test_refresh_keeps_previous_items_when_a_source_fails(tmp_path: Path) -> None:
    path = tmp_path / "feeds.json"
    path.write_text(json.dumps(DEFAULT_FEEDS), encoding="utf-8")

    def fetch(url: str) -> bytes:
        if "youtube" in url:
            return YOUTUBE_XML
        raise OSError("substack is down")

    refreshed, failures = refresh_snapshot(path, fetch=fetch, today=date(2026, 10, 27))
    assert refreshed == ["youtube"]
    assert failures and "substack" in failures[0]
    document = json.loads(path.read_text(encoding="utf-8"))
    assert document["refreshed"] == "2026-10-27"
    assert document["sources"]["youtube"]["items"][0]["title"] == "Video & One"
    assert document["sources"]["substack"]["items"][0]["title"] == "10MB to 1T, $5000 to $100, Wow :)"


def test_refresh_refuses_doctype(tmp_path: Path) -> None:
    path = tmp_path / "feeds.json"
    path.write_text(json.dumps(DEFAULT_FEEDS), encoding="utf-8")
    payload = b'<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY x "y">]><rss version="2.0"><channel><title>x</title></channel></rss>'
    refreshed, failures = refresh_snapshot(path, fetch=lambda url: payload, today=date(2026, 10, 27))
    assert refreshed == []
    assert len(failures) == 2


def test_refresh_output_is_deterministic(tmp_path: Path) -> None:
    first = tmp_path / "one.json"
    second = tmp_path / "two.json"

    def fetch(url: str) -> bytes:
        return YOUTUBE_XML if "youtube" in url else SUBSTACK_XML

    refresh_snapshot(first, fetch=fetch, today=date(2026, 10, 27))
    refresh_snapshot(second, fetch=fetch, today=date(2026, 10, 27))
    assert first.read_bytes() == second.read_bytes()
