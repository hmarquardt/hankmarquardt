"""Front matter, slug, URL and Markdown safety tests."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
from conftest import DRAFT_NOTE, PUBLISHED_NOTE

from sitegen.content import (
    ContentError,
    draft_notes,
    load_notes,
    parse_front_matter,
    published_notes,
    render_markdown,
    split_front_matter,
    validate_canonical,
    validate_slug,
    validate_url,
)

GOOD_FRONT = """\
title: "A note"
date: 2026-09-01
description: "A description long enough to be a real meta description, honestly."
tags: [testing]
status: published
"""


def note(notes_dir: Path, name: str, *, body: str = "Body text.", front: str = GOOD_FRONT) -> Path:
    notes_dir.mkdir(parents=True, exist_ok=True)
    path = notes_dir / name
    path.write_text(f"---\n{front}---\n\n{body}\n", encoding="utf-8")
    return path


def test_front_matter_split_handles_crlf_and_bom() -> None:
    text = "\ufeff---\r\ntitle: x\r\n---\r\n\r\nbody\r\n"
    front, body = split_front_matter(text, source="x.md")
    assert "title: x" in front
    assert body.strip() == "body"


@pytest.mark.parametrize(
    "text",
    ["no front matter", "---\ntitle: x\n", "---\ntitle: x\nbody"],
)
def test_front_matter_must_be_closed(text: str) -> None:
    with pytest.raises(ContentError):
        split_front_matter(text, source="x.md")


def test_unknown_and_missing_keys_are_refused() -> None:
    with pytest.raises(ContentError, match="unknown front matter keys"):
        parse_front_matter(GOOD_FRONT + "author: someone\n", source="x.md")
    with pytest.raises(ContentError, match="missing front matter keys"):
        parse_front_matter("title: x\ndate: 2026-01-01\n", source="x.md")


def test_duplicate_yaml_keys_are_refused() -> None:
    front = GOOD_FRONT.replace('title: "A note"', 'title: "A note"\ntitle: "Another"')
    with pytest.raises(ContentError, match="duplicate front matter key"):
        parse_front_matter(front, source="x.md")


@pytest.mark.parametrize("status", ["published ", "PUBLISHED", "draft", "review"])
def test_status_values(status: str) -> None:
    front = GOOD_FRONT.replace("status: published", f"status: {status}")
    if status.strip().lower() in {"published", "draft"}:
        assert parse_front_matter(front, source="x.md")["status"] == status.strip().lower()
    else:
        with pytest.raises(ContentError):
            parse_front_matter(front, source="x.md")


def test_description_bounds() -> None:
    short = GOOD_FRONT.replace(
        "A description long enough to be a real meta description, honestly.", "too short"
    )
    with pytest.raises(ContentError, match="at least 40 characters"):
        parse_front_matter(short, source="x.md")
    long = GOOD_FRONT.replace(
        "A description long enough to be a real meta description, honestly.", "x" * 321
    )
    with pytest.raises(ContentError, match="at most 320 characters"):
        parse_front_matter(long, source="x.md")


def test_tags_are_normalised_and_bounded() -> None:
    front = GOOD_FRONT.replace("[testing]", "[Testing, testing, Cloudflare / Static Sites]")
    parsed = parse_front_matter(front, source="x.md")
    assert parsed["tags"] == ("testing", "cloudflare / static sites")
    with pytest.raises(ContentError):
        parse_front_matter(GOOD_FRONT.replace("[testing]", "[UPPER CASE!]"), source="x.md")
    with pytest.raises(ContentError, match="at most 6 tags"):
        parse_front_matter(GOOD_FRONT.replace("[testing]", "[a, b, c, d, e, f, g]"), source="x.md")


@pytest.mark.parametrize(
    "bad", ["Not-A-Slug", "with space", "with.dot", "-leading", "trailing-", "", "a" * 81]
)
def test_slug_rejects_invalid_names(bad: str) -> None:
    with pytest.raises(ContentError):
        validate_slug(bad)


@pytest.mark.parametrize("bad", ["index", "feed", "notes", "404", "sitemap"])
def test_slug_rejects_reserved_names(bad: str) -> None:
    with pytest.raises(ContentError, match="reserved"):
        validate_slug(bad)


def test_slug_rejects_traversal() -> None:
    for bad in ("../etc", "notes/../../x", "..", "%2e%2e"):
        with pytest.raises(ContentError):
            validate_slug(bad)


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/page",
        "http://example.com/",
        "mailto:hank@example.com",
        "/work/",
        "#section",
        "relative/path",
    ],
)
def test_safe_urls_pass(url: str) -> None:
    assert validate_url(url, source="t") == url


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "vbscript:msgbox(1)",
        "//evil.example.com/x",
        "https://user:pass@example.com/",
        "https://localhost/",
        "https:///nohost",
        "mailto:not-an-address",
        "../escape",
        "/notes/../../etc/passwd",
        "https://example.com/\nheader: injected",
    ],
)
def test_unsafe_urls_fail(url: str) -> None:
    with pytest.raises(ContentError):
        validate_url(url, source="t")


def test_canonical_must_be_https_and_absolute() -> None:
    assert validate_canonical("https://example.com/x", source="c") == "https://example.com/x"
    for bad in ("http://example.com/x", "/relative", "https://example.com/x#frag", "mailto:a@b.co"):
        with pytest.raises(ContentError):
            validate_canonical(bad, source="c")


def test_raw_html_is_escaped_not_executed() -> None:
    html = render_markdown("<script>alert(1)</script>\n\nHello", source="x.md")
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_unsafe_markdown_links_never_render() -> None:
    html = render_markdown("[click](javascript:alert(1))", source="x.md")
    assert 'href="javascript:' not in html
    assert "<a " not in html
    with pytest.raises(ContentError, match="protocol-relative"):
        render_markdown("[click](//evil.example.com/x)", source="x.md")


def test_path_traversal_in_markdown_links_is_refused() -> None:
    with pytest.raises(ContentError, match="path traversal"):
        render_markdown("[x](../secret)", source="x.md")


def test_external_links_gain_rel_and_headings_get_unique_ids() -> None:
    html = render_markdown("## Same\n\n[site](https://example.com/x)\n\n## Same\n", source="x.md")
    assert 'rel="noopener noreferrer"' in html
    assert 'id="same"' in html
    assert 'id="same-2"' in html


def test_external_images_are_refused() -> None:
    with pytest.raises(ContentError, match="site-relative"):
        render_markdown("![alt](https://example.com/x.png)", source="x.md")
    assert 'src="/images/x.png"' in render_markdown("![alt](/images/x.png)", source="x.md")


def test_notes_load_published_and_draft(tmp_path: Path) -> None:
    notes_dir = tmp_path / "notes"
    note(notes_dir, "published-note.md", front=GOOD_FRONT)
    note(notes_dir, "a-draft.md", front=GOOD_FRONT.replace("status: published", "status: draft"))
    notes = load_notes(sorted(notes_dir.iterdir()), today=date(2026, 10, 26))
    assert [n.slug for n in published_notes(notes)] == ["published-note"]
    assert [n.slug for n in draft_notes(notes)] == ["a-draft"]


def test_duplicate_slugs_are_refused(tmp_path: Path) -> None:
    first = note(tmp_path / "a", "dup.md")
    second = note(tmp_path / "b", "dup.md")
    with pytest.raises(ContentError, match="duplicate slug"):
        load_notes([first, second])


def test_published_note_in_the_future_fails(tmp_path: Path) -> None:
    path = note(
        tmp_path / "notes",
        "future-note.md",
        front=GOOD_FRONT.replace("date: 2026-09-01", "date: 2027-01-01"),
    )
    with pytest.raises(ContentError, match="future"):
        load_notes([path], today=date(2026, 10, 26))


def test_missing_body_fails(tmp_path: Path) -> None:
    path = note(tmp_path / "notes", "empty.md", body="   ")
    with pytest.raises(ContentError, match="body is empty"):
        load_notes([path])


def test_fixture_notes_are_valid(tmp_path: Path) -> None:
    notes_dir = tmp_path / "notes"
    notes_dir.mkdir()
    (notes_dir / "first-note.md").write_text(PUBLISHED_NOTE, encoding="utf-8")
    (notes_dir / "secret-draft.md").write_text(DRAFT_NOTE, encoding="utf-8")
    assert len(load_notes(sorted(notes_dir.iterdir()), today=date(2026, 10, 26))) == 2

