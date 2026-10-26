"""Field Notes content: front matter parsing, validation and safe Markdown."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlsplit

import yaml
from markdown_it import MarkdownIt

from .errors import ContentError

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
RESERVED_SLUGS = frozenset({"index", "feed", "notes", "rss", "sitemap", "404"})
ALLOWED_KEYS = frozenset({"title", "date", "description", "tags", "status", "canonical"})
REQUIRED_KEYS = frozenset({"title", "date", "description", "tags", "status"})
STATUSES = frozenset({"draft", "published"})
TAG_RE = re.compile(r"^[a-z0-9][a-z0-9 /&+-]{0,38}$")
MAILTO_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
MAX_SLUG_LENGTH = 80


class _StrictLoader(yaml.SafeLoader):
    """SafeLoader that refuses duplicate keys instead of silently keeping the last."""


def _strict_mapping(loader: yaml.Loader, node: yaml.Node) -> dict[object, object]:
    mapping: dict[object, object] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=True)
        try:
            duplicate = key in mapping
        except TypeError as error:  # unhashable key
            raise ContentError("front matter keys must be plain strings") from error
        if duplicate:
            raise ContentError(f"duplicate front matter key: {key!r}")
        mapping[key] = loader.construct_object(value_node, deep=True)
    return mapping


_StrictLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _strict_mapping,
)


@dataclass(frozen=True)
class Note:
    """One Field Note. Drafts are loaded for validation but never rendered."""

    slug: str
    title: str
    date: date
    description: str
    tags: tuple[str, ...]
    status: str
    canonical: str | None
    body: str
    source: str
    html: str = field(compare=False, default="")

    @property
    def published(self) -> bool:
        return self.status == "published"

    @property
    def path(self) -> str:
        return f"/notes/{self.slug}/"

    @property
    def year(self) -> int:
        return self.date.year



def validate_slug(slug: str, *, source: str = "slug") -> str:
    """Reject anything that is not a short, flat, lowercase URL segment."""

    if not isinstance(slug, str) or not slug:
        raise ContentError(f"{source}: slug is empty")
    if len(slug) > MAX_SLUG_LENGTH:
        raise ContentError(f"{source}: slug is longer than {MAX_SLUG_LENGTH} characters")
    if slug in RESERVED_SLUGS:
        raise ContentError(f"{source}: slug {slug!r} is reserved")
    if not SLUG_RE.match(slug):
        raise ContentError(
            f"{source}: slug {slug!r} must be lowercase letters, digits and single hyphens"
        )
    return slug


def validate_url(
    value: object,
    *,
    source: str,
    allow_mailto: bool = True,
    allow_relative: bool = True,
) -> str:
    """Validate a link target. Only http(s), mailto and site-relative paths pass."""

    if not isinstance(value, str):
        raise ContentError(f"{source}: link target must be a string")
    if not value or len(value) > 2048:
        raise ContentError(f"{source}: link target is empty or too long")
    if CONTROL_RE.search(value) or any(ch in value for ch in "\n\r\t"):
        raise ContentError(f"{source}: link target contains control characters")
    if value.startswith("//"):
        raise ContentError(f"{source}: protocol-relative links are not allowed: {value!r}")

    parts = urlsplit(value)
    scheme = parts.scheme.lower()
    if scheme:
        if scheme in {"http", "https"}:
            if not parts.hostname:
                raise ContentError(f"{source}: {value!r} has no host")
            if parts.username or parts.password:
                raise ContentError(f"{source}: credentials in a URL are not allowed")
            if "." not in parts.hostname:
                raise ContentError(f"{source}: {value!r} must use a public hostname")
            try:
                _ = parts.port
            except ValueError as error:
                raise ContentError(f"{source}: {value!r} has an invalid port") from error
            return value
        if scheme == "mailto" and allow_mailto:
            if not MAILTO_RE.match(parts.path):
                raise ContentError(f"{source}: invalid mailto address in {value!r}")
            return value
        raise ContentError(f"{source}: unsafe URL scheme {scheme!r} in {value!r}")

    if not allow_relative:
        raise ContentError(f"{source}: expected an absolute URL, got {value!r}")
    if "\\" in value:
        raise ContentError(f"{source}: backslashes are not allowed in {value!r}")
    if any(segment == ".." for segment in parts.path.split("/")):
        raise ContentError(f"{source}: path traversal is not allowed in {value!r}")
    return value


def validate_canonical(value: object, *, source: str) -> str:
    url = validate_url(value, source=source, allow_mailto=False, allow_relative=False)
    parts = urlsplit(url)
    if parts.scheme.lower() != "https":
        raise ContentError(f"{source}: canonical URL must use https")
    if parts.fragment:
        raise ContentError(f"{source}: canonical URL must not contain a fragment")
    return url


def _require_text(value: object, *, source: str, minimum: int, maximum: int) -> str:
    if not isinstance(value, str):
        raise ContentError(f"{source}: expected text, got {type(value).__name__}")
    text = value.strip()
    if len(text) < minimum:
        raise ContentError(f"{source}: must be at least {minimum} characters")
    if len(text) > maximum:
        raise ContentError(f"{source}: must be at most {maximum} characters")
    if CONTROL_RE.search(text) or any(ch in text for ch in "\n\r"):
        raise ContentError(f"{source}: must be a single line of text")
    return text


def _require_date(value: object, *, source: str) -> date:
    if isinstance(value, datetime):
        raise ContentError(f"{source}: use a date (YYYY-MM-DD), not a timestamp")
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value.strip())
        except ValueError as error:
            raise ContentError(f"{source}: expected YYYY-MM-DD, got {value!r}") from error
    raise ContentError(f"{source}: expected a date (YYYY-MM-DD)")


def _require_tags(value: object, *, source: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list):
        raise ContentError(f"{source}: tags must be a list")
    if len(value) > 6:
        raise ContentError(f"{source}: at most 6 tags")
    tags: list[str] = []
    for tag in value:
        if not isinstance(tag, str):
            raise ContentError(f"{source}: each tag must be text")
        cleaned = tag.strip().lower()
        if not TAG_RE.match(cleaned):
            raise ContentError(
                f"{source}: tag {tag!r} must be lowercase letters, digits, spaces or / & + -"
            )
        if cleaned not in tags:
            tags.append(cleaned)
    return tuple(tags)


def split_front_matter(text: str, *, source: str) -> tuple[str, str]:
    """Split a YAML front matter block from the Markdown body."""

    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    normalized = normalized.removeprefix("\ufeff")
    if not normalized.startswith("---\n"):
        raise ContentError(f"{source}: file must start with a '---' front matter block")
    end = normalized.find("\n---\n", 3)
    if end == -1:
        raise ContentError(f"{source}: front matter block is not closed with '---' on its own line")
    front = normalized[4:end]
    body = normalized[end + 5 :]
    return front, body


def parse_front_matter(front: str, *, source: str) -> dict[str, object]:
    """Parse and validate the front matter keys. Unknown keys are an error."""

    try:
        data = yaml.load(front, Loader=_StrictLoader)
    except yaml.YAMLError as error:
        raise ContentError(f"{source}: invalid YAML front matter: {error}") from error
    if not isinstance(data, dict):
        raise ContentError(f"{source}: front matter must be a mapping of keys to values")

    keys = {str(key) for key in data}
    unknown = keys - ALLOWED_KEYS
    if unknown:
        raise ContentError(f"{source}: unknown front matter keys: {', '.join(sorted(unknown))}")
    missing = REQUIRED_KEYS - keys
    if missing:
        raise ContentError(f"{source}: missing front matter keys: {', '.join(sorted(missing))}")

    status = data["status"]
    if not isinstance(status, str) or status.strip().lower() not in STATUSES:
        raise ContentError(f"{source}: status must be 'draft' or 'published'")

    canonical = data.get("canonical")
    return {
        "title": _require_text(data["title"], source=f"{source}: title", minimum=1, maximum=120),
        "date": _require_date(data["date"], source=f"{source}: date"),
        "description": _require_text(
            data["description"], source=f"{source}: description", minimum=40, maximum=320
        ),
        "tags": _require_tags(data["tags"], source=f"{source}: tags"),
        "status": status.strip().lower(),
        "canonical": (
            None if canonical is None else validate_canonical(canonical, source=f"{source}: canonical")
        ),
    }


class _Slugger:
    """Deterministic, unique heading ids."""

    def __init__(self) -> None:
        self._seen: dict[str, int] = {}

    def slug(self, text: str) -> str:
        normalized = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
        slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
        slug = slug or "section"
        count = self._seen.get(slug, 0) + 1
        self._seen[slug] = count
        return slug if count == 1 else f"{slug}-{count}"


_MARKDOWN = MarkdownIt(
    "commonmark",
    {"html": False, "linkify": False, "breaks": False, "typographer": False},
).enable("table")


def _inline_text(token: object) -> str:
    children = getattr(token, "children", None) or []
    return "".join(child.content for child in children if child.type in {"text", "code_inline"})


def _external(href: str) -> bool:
    return href.lower().startswith(("http://", "https://"))


def render_markdown(body: str, *, source: str) -> str:
    """Render Markdown with raw HTML disabled and every link target validated.

    ``html=False`` turns raw HTML into visible text. Link and image targets are
    checked after parsing because Markdown can carry a URL that looks harmless
    until it is resolved.
    """

    tokens = _MARKDOWN.parse(body)
    slugger = _Slugger()
    for index, token in enumerate(tokens):
        if token.type in {"html_block", "html_inline"}:
            raise ContentError(f"{source}: raw HTML is not allowed")
        if token.type == "heading_open" and index + 1 < len(tokens):
            token.attrSet("id", slugger.slug(_inline_text(tokens[index + 1])))
        if token.type == "inline":
            for child in token.children or []:
                if child.type == "link_open":
                    href = child.attrGet("href") or ""
                    validate_url(href, source=f"{source}: link")
                    if _external(href):
                        child.attrSet("rel", "noopener noreferrer")
                elif child.type == "image":
                    src = child.attrGet("src") or ""
                    validate_url(src, source=f"{source}: image", allow_mailto=False)
                    if not src.startswith("/") or src.startswith("//"):
                        raise ContentError(
                            f"{source}: image {src!r} must be a site-relative path such as "
                            "/images/photo.webp (files live in static/)"
                        )
    return _MARKDOWN.renderer.render(tokens, _MARKDOWN.options, {})


def load_note(path: Path) -> Note:
    """Read and validate one note file."""

    source = path.name
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise ContentError(f"{source}: cannot read file: {error}") from error
    front, body = split_front_matter(text, source=source)
    fields = parse_front_matter(front, source=source)
    slug = validate_slug(path.stem, source=source)
    if not body.strip():
        raise ContentError(f"{source}: body is empty")
    return Note(
        slug=slug,
        title=fields["title"],
        date=fields["date"],
        description=fields["description"],
        tags=fields["tags"],
        status=fields["status"],
        canonical=fields["canonical"],
        body=body,
        source=source,
        html=render_markdown(body, source=source),
    )


def discover_notes(notes_dir: Path) -> list[Path]:
    if not notes_dir.is_dir():
        raise ContentError(f"{notes_dir}: notes directory does not exist")
    return sorted(path for path in notes_dir.iterdir() if path.suffix == ".md" and path.is_file())


def load_notes(paths: Iterable[Path], *, today: date | None = None) -> list[Note]:
    """Load every note, refusing duplicates and published notes dated in the future."""

    notes: list[Note] = []
    seen: dict[str, str] = {}
    for path in sorted(paths, key=lambda item: (item.stem, item.name)):
        note = load_note(path)
        key = note.slug.casefold()
        if key in seen:
            raise ContentError(f"{note.source}: duplicate slug {note.slug!r} (also in {seen[key]})")
        seen[key] = note.source
        notes.append(note)

    check_date = today or date.today()
    for note in notes:
        if note.published and note.date > check_date:
            raise ContentError(
                f"{note.source}: published notes cannot be dated in the future ({note.date})"
            )
    return sorted(notes, key=lambda note: (note.date, note.slug), reverse=True)


def published_notes(notes: Iterable[Note]) -> list[Note]:
    return [note for note in notes if note.published]


def draft_notes(notes: Iterable[Note]) -> list[Note]:
    return [note for note in notes if not note.published]
