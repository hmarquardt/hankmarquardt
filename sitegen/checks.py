"""Structural checks over a built site.

These are deliberately offline and dependency-free: HTML structure, metadata,
internal links, feeds, sitemap and draft leakage. They run in CI and locally.
"""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from html.parser import HTMLParser
from itertools import pairwise
from pathlib import Path
from urllib.parse import unquote, urlsplit

VOID_ELEMENTS = frozenset(
    {
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    }
)


@dataclass
class Document:
    path: Path
    lang: str | None = None
    title: str = ""
    h1: list[str] = field(default_factory=list)
    headings: list[str] = field(default_factory=list)
    ids: list[str] = field(default_factory=list)
    metas: dict[str, str] = field(default_factory=dict)
    links: list[dict[str, str]] = field(default_factory=list)
    anchors: list[str] = field(default_factory=list)
    images: list[dict[str, str]] = field(default_factory=list)
    scripts: int = 0
    structured_data: list[str] = field(default_factory=list)
    stylesheets: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    text: list[str] = field(default_factory=list)

    @property
    def body_text(self) -> str:
        return " ".join(self.text)


class _Parser(HTMLParser):
    def __init__(self, document: Document) -> None:
        super().__init__(convert_charrefs=True)
        self.document = document
        self.stack: list[str] = []
        self._in: str | None = None
        self._buffer: list[str] = []

    def handle_decl(self, decl: str) -> None:
        if decl.strip().lower() != "doctype html":
            self.document.errors.append(f"unexpected doctype: {decl!r}")

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {name.lower(): (value or "") for name, value in attrs}
        tag = tag.lower()
        if tag == "html":
            self.document.lang = attributes.get("lang")
        elif tag == "meta":
            key = attributes.get("name") or attributes.get("property")
            if key:
                self.document.metas[key.lower()] = attributes.get("content", "")
        elif tag == "link":
            self.document.links.append(attributes)
            if attributes.get("rel") == "stylesheet":
                self.document.stylesheets.append(attributes.get("href", ""))
        elif tag == "a":
            self.document.anchors.append(attributes.get("href", ""))
        elif tag == "img":
            self.document.images.append(attributes)
            if "alt" not in attributes:
                self.document.errors.append(f"<img> without alt: {attributes.get('src', '')}")
        elif tag == "script":
            if attributes.get("type") == "application/ld+json" and set(attributes) == {"type"}:
                self._in = "script"
                self._buffer = []
            else:
                self.document.scripts += 1
        elif tag == "title":
            self._in = tag
            self._buffer = []
        elif tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self.document.headings.append(tag)
            self._in = tag
            self._buffer = []
        if "id" in attributes:
            if attributes["id"] in self.document.ids:
                self.document.errors.append(f"duplicate id: {attributes['id']!r}")
            self.document.ids.append(attributes["id"])
        for name in attributes:
            if name.startswith("on"):
                self.document.errors.append(f"inline event handler on <{tag}>: {name}")

        if tag not in VOID_ELEMENTS:
            self.stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in VOID_ELEMENTS:
            return
        if not self.stack:
            self.document.errors.append(f"unexpected closing </{tag}>")
            return
        if self.stack[-1] != tag:
            self.document.errors.append(
                f"mismatched tags: expected </{self.stack[-1]}>, found </{tag}>"
            )
            if tag in self.stack:
                while self.stack and self.stack.pop() != tag:
                    pass
            return
        self.stack.pop()
        if self._in == tag:
            text = re.sub(r"\s+", " ", "".join(self._buffer)).strip()
            if tag == "h1":
                self.document.h1.append(text)
            elif tag == "title":
                self.document.title = text
            elif tag == "script":
                self.document.structured_data.append("".join(self._buffer))
            self._in = None

    def handle_data(self, data: str) -> None:
        text = re.sub(r"\s+", " ", data).strip()
        if text:
            self.document.text.append(text)
        if self._in:
            self._buffer.append(data)

    def close(self) -> None:
        super().close()
        if self.stack:
            self.document.errors.append(f"unclosed tags: {', '.join(self.stack)}")


def parse_html(path: Path) -> Document:
    document = Document(path=path)
    parser = _Parser(document)
    parser.feed(path.read_text(encoding="utf-8"))
    parser.close()
    return document


def resolve_internal(dist: Path, href: str) -> Path | None:
    """Map a site-relative href to the file that must exist, if it is internal."""

    parts = urlsplit(href)
    if parts.scheme or parts.netloc:
        return None
    if not parts.path:
        return None  # pure fragment
    path = unquote(parts.path)
    if not path.startswith("/"):
        return None
    root = dist.resolve()
    target = (root / path.lstrip("/")).resolve()
    if root not in target.parents and target != root:
        return None
    if path.endswith("/"):
        return target / "index.html"
    if target.suffix:
        return target
    return target / "index.html"


def _check_document(document: Document, dist: Path, *, is_404: bool) -> list[str]:
    problems = [f"{document.path.relative_to(dist)}: {error}" for error in document.errors]
    rel = document.path.relative_to(dist)
    if document.lang != "en":
        problems.append(f"{rel}: <html lang> must be 'en'")
    if not document.title.strip():
        problems.append(f"{rel}: missing <title>")
    description = document.metas.get("description", "")
    if not (40 <= len(description) <= 320):
        problems.append(f"{rel}: meta description must be 40-320 characters")
    if "viewport" not in document.metas:
        problems.append(f"{rel}: missing viewport meta")
    if "color-scheme" not in document.metas:
        problems.append(f"{rel}: missing color-scheme meta")
    if is_404:
        if document.metas.get("robots") != "noindex, follow":
            problems.append(f"{rel}: 404 page must be noindex")
        if any(link.get("rel") == "canonical" for link in document.links):
            problems.append(f"{rel}: 404 page must not declare a canonical URL")
    elif not any(link.get("rel") == "canonical" for link in document.links):
        problems.append(f"{rel}: missing canonical link")
    if len(document.h1) != 1:
        problems.append(f"{rel}: expected exactly one <h1>, found {len(document.h1)}")
    if document.scripts:
        problems.append(f"{rel}: this site ships no client JavaScript, found {document.scripts} scripts")
    if rel.as_posix() in {"index.html", "about/index.html"}:
        if len(document.structured_data) != 1:
            problems.append(f"{rel}: expected one Person JSON-LD block")
        else:
            try:
                data = json.loads(document.structured_data[0])
                if (data.get("@type") != "Person"
                    or data.get("name") != "Hank Marquardt"
                    or data.get("url") != "https://hankmarquardt.com/"
                    or data.get("@id") != "https://hankmarquardt.com/#person"
                    or not isinstance(data.get("sameAs"), list)):
                    problems.append(f"{rel}: invalid Person structured data")
            except (ValueError, AttributeError):
                problems.append(f"{rel}: malformed Person structured data")
    elif document.structured_data:
        problems.append(f"{rel}: unexpected structured data block")
    if document.stylesheets != ["/styles.css"]:
        problems.append(f"{rel}: expected /styles.css as the only stylesheet")
    if "main" not in document.ids:
        problems.append(f'{rel}: missing <main id="main">')
    if "#main" not in document.anchors:
        problems.append(f"{rel}: missing skip link to #main")
    if "og:title" not in document.metas or "og:description" not in document.metas:
        problems.append(f"{rel}: missing Open Graph title/description")
    if document.metas.get("twitter:card") != "summary":
        problems.append(f"{rel}: missing twitter:card summary")

    levels = [int(tag[1]) for tag in document.headings]
    for previous, current in pairwise(levels):
        if current > previous + 1:
            problems.append(f"{rel}: heading level jumps from h{previous} to h{current}")

    for anchor in document.anchors:
        if not anchor.strip():
            problems.append(f"{rel}: empty href")
        elif anchor.startswith(("http://", "//")):
            problems.append(f"{rel}: insecure or protocol-relative link: {anchor}")
        else:
            target = resolve_internal(dist, anchor)
            if target is not None and not target.is_file():
                problems.append(f"{rel}: link target does not exist: {anchor}")
    for stylesheet in document.stylesheets:
        if not (dist / stylesheet.lstrip("/")).is_file():
            problems.append(f"{rel}: stylesheet does not exist: {stylesheet}")
    for image in document.images:
        src = image.get("src", "")
        if not src.startswith("/") or src.startswith("//"):
            problems.append(f"{rel}: image must be site-relative: {src}")
        elif not (dist / src.lstrip("/")).is_file():
            problems.append(f"{rel}: image does not exist: {src}")
    return problems



def check_site(
    dist: Path, *, draft_slugs: tuple[str, ...] = (), published_slugs: tuple[str, ...] = ()
) -> list[str]:
    """Return every structural problem found in the built site."""

    dist = dist.resolve()
    problems: list[str] = []
    html_files = sorted(dist.rglob("*.html"))
    if not html_files:
        return [f"{dist}: no HTML output"]

    documents: list[Document] = []
    for path in html_files:
        document = parse_html(path)
        documents.append(document)
        problems.extend(_check_document(document, dist, is_404=path.name == "404.html"))

    for required in (
        "styles.css",
        "favicon.svg",
        "robots.txt",
        "sitemap.xml",
        "notes/feed.xml",
        "version.json",
    ):
        if not (dist / required).is_file():
            problems.append(f"missing output file: {required}")

    robots = (dist / "robots.txt").read_text(encoding="utf-8")
    if "Sitemap: https://hankmarquardt.com/sitemap.xml" not in robots:
        problems.append("robots.txt: missing sitemap declaration")

    try:
        sitemap = ET.fromstring((dist / "sitemap.xml").read_bytes())
    except ET.ParseError as error:
        problems.append(f"sitemap.xml: not valid XML: {error}")
        sitemap = None
    if sitemap is not None:
        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        locations = [node.text or "" for node in sitemap.findall("sm:url/sm:loc", ns)]
        if not locations:
            problems.append("sitemap.xml: no URLs")
        for location in locations:
            if not location.startswith("https://hankmarquardt.com/"):
                problems.append(f"sitemap.xml: unexpected origin in {location}")
                continue
            path = urlsplit(location).path
            target = dist / path.lstrip("/")
            if path.endswith("/"):
                target = target / "index.html"
            if not target.is_file():
                problems.append(f"sitemap.xml: URL has no file: {location}")
        for slug in draft_slugs:
            if any(f"/notes/{slug}/" in location for location in locations):
                problems.append(f"sitemap.xml: draft note is listed: {slug}")

    try:
        feed = ET.fromstring((dist / "notes" / "feed.xml").read_bytes())
    except ET.ParseError as error:
        problems.append(f"notes/feed.xml: not valid XML: {error}")
        feed = None
    if feed is not None:
        for item in feed.findall("./channel/item"):
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            if not title or not link.startswith("https://hankmarquardt.com/notes/"):
                problems.append(f"notes/feed.xml: invalid item {title!r}")
            if not (item.findtext("pubDate") or "").strip():
                problems.append(f"notes/feed.xml: item without pubDate: {title!r}")

    version = json.loads((dist / "version.json").read_text(encoding="utf-8"))
    if not re.fullmatch(r"[a-f0-9]{40}|uncommitted", str(version.get("commit", ""))):
        problems.append("version.json: commit must be a full SHA or 'uncommitted'")

    text = "\n".join(
        [document.body_text for document in documents]
        + [anchor for document in documents for anchor in document.anchors]
    )
    for slug in draft_slugs:
        if f"/notes/{slug}/" in text:
            problems.append(f"draft note is referenced in published HTML: {slug}")
        if (dist / "notes" / slug).exists():
            problems.append(f"draft note was written to output: {slug}")
    for slug in published_slugs:
        if slug and f"/notes/{slug}/" not in text:
            problems.append(f"published note is not linked anywhere: {slug}")

    for document in documents:
        if re.search(r"streamlit", document.body_text, re.IGNORECASE):
            problems.append(f"{document.path.relative_to(dist)}: legacy Streamlit reference")
    return problems

    return document
