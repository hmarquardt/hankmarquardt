"""Build output, draft exclusion, feeds, sitemap, determinism and safety."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from conftest import COMMIT, DEFAULT_FEEDS, DRAFT_NOTE, PUBLISHED_NOTE, REPO, TODAY

from sitegen.build import build_site, prepare_output
from sitegen.checks import check_site
from sitegen.errors import BuildError

ALL_NOTES = {"first-note.md": PUBLISHED_NOTE, "secret-draft.md": DRAFT_NOTE}


def digest_tree(root: Path) -> dict[str, str]:
    return {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def test_expected_output_files(build) -> None:
    result = build(notes=ALL_NOTES, feeds=DEFAULT_FEEDS)
    expected = {
        "index.html",
        "work/index.html",
        "notes/index.html",
        "notes/first-note/index.html",
        "about/index.html",
        "elsewhere/index.html",
        "404.html",
        "notes/feed.xml",
        "sitemap.xml",
        "robots.txt",
        "styles.css",
        "favicon.svg",
        "version.json",
        ".assetsignore",
    }
    written = {str(path.relative_to(result.out)) for path in result.out.rglob("*") if path.is_file()}
    assert expected <= written
    assert [note.slug for note in result.published] == ["first-note"]
    assert [note.slug for note in result.drafts] == ["secret-draft"]
    assert result.commit == COMMIT
    assert result.feed_problems == ()


def test_article_metadata(build) -> None:
    result = build(notes=ALL_NOTES, feeds=DEFAULT_FEEDS)
    html = (result.out / "notes" / "first-note" / "index.html").read_text(encoding="utf-8")
    assert "<title>The First Note — Hank Marquardt</title>" in html
    assert '<link rel="canonical" href="https://hankmarquardt.com/notes/first-note/">' in html
    assert 'property="og:type" content="article"' in html
    assert 'property="article:published_time" content="2026-09-01T12:00:00Z"' in html
    assert '<time datetime="2026-09-01">' in html
    assert "September 1, 2026" in html
    assert '<span class="tag">testing</span>' in html
    assert 'id="a-heading"' in html
    assert 'id="a-heading-2"' in html
    assert "DRAFT-SECRET-MARKER" not in html


def test_drafts_never_reach_output(build) -> None:
    result = build(notes=ALL_NOTES, feeds=DEFAULT_FEEDS)
    assert not (result.out / "notes" / "secret-draft").exists()
    for path in result.out.rglob("*"):
        if path.is_file():
            data = path.read_bytes()
            assert b"DRAFT-SECRET-MARKER" not in data, path
            assert b"secret-draft" not in data, path
            assert b"Secret Draft Title" not in data, path
    index = (result.out / "notes" / "index.html").read_text(encoding="utf-8")
    assert "No published notes yet" not in index
    assert "The First Note" in index


def test_sitemap_and_feed_include_only_published_notes(build) -> None:
    result = build(notes=ALL_NOTES, feeds=DEFAULT_FEEDS)
    sitemap = (result.out / "sitemap.xml").read_text(encoding="utf-8")
    assert "https://hankmarquardt.com/notes/first-note/" in sitemap
    assert "<lastmod>2026-09-01</lastmod>" in sitemap
    assert "secret-draft" not in sitemap
    feed = (result.out / "notes" / "feed.xml").read_text(encoding="utf-8")
    assert "<title>The First Note</title>" in feed
    assert "<pubDate>Tue, 01 Sep 2026 12:00:00 +0000</pubDate>" in feed
    assert "secret-draft" not in feed
    assert feed.count("<item>") == 1


def test_empty_site_has_thoughtful_state_and_valid_feed(build) -> None:
    result = build(notes={}, feeds=DEFAULT_FEEDS)
    index = (result.out / "notes" / "index.html").read_text(encoding="utf-8")
    assert "No published notes yet" in index
    feed = (result.out / "notes" / "feed.xml").read_text(encoding="utf-8")
    assert "<item>" not in feed
    assert "lastBuildDate" not in feed
    sitemap = (result.out / "sitemap.xml").read_text(encoding="utf-8")
    assert "/notes/" in sitemap


def test_no_client_javascript(build) -> None:
    result = build(notes=ALL_NOTES, feeds=DEFAULT_FEEDS)
    for path in result.out.rglob("*.html"):
        assert "<script" not in path.read_text(encoding="utf-8").lower(), path


def test_metadata_is_escaped(build) -> None:
    hostile = PUBLISHED_NOTE.replace(
        'title: "The First Note"', 'title: "Frogs & <Toads> \\"Quoted\\""'
    )
    result = build(notes={"hostile.md": hostile}, feeds=DEFAULT_FEEDS)
    html = (result.out / "notes" / "hostile" / "index.html").read_text(encoding="utf-8")
    assert "<Toads>" not in html
    assert "Frogs &amp; &lt;Toads&gt;" in html
    feed = (result.out / "notes" / "feed.xml").read_text(encoding="utf-8")
    assert "&lt;Toads&gt;" in feed


def test_nav_marks_the_current_section(build) -> None:
    result = build(notes=ALL_NOTES, feeds=DEFAULT_FEEDS)
    note = (result.out / "notes" / "first-note" / "index.html").read_text(encoding="utf-8")
    assert '<a href="/notes/" aria-current="page">Field Notes</a>' in note
    home = (result.out / "index.html").read_text(encoding="utf-8")
    assert 'aria-current="page"' not in home
    not_found = (result.out / "404.html").read_text(encoding="utf-8")
    assert 'aria-current="page"' not in not_found


def test_structural_checks_pass(build) -> None:
    result = build(notes=ALL_NOTES, feeds=DEFAULT_FEEDS)
    problems = check_site(
        result.out,
        draft_slugs=("secret-draft",),
        published_slugs=("first-note",),
    )
    assert problems == []


def test_build_is_deterministic(build, tmp_path: Path) -> None:
    first = build(notes=ALL_NOTES, feeds=DEFAULT_FEEDS, directory=tmp_path / "one")
    second = build(notes=ALL_NOTES, feeds=DEFAULT_FEEDS, directory=tmp_path / "two")
    assert digest_tree(first.out) == digest_tree(second.out)


def test_feed_snapshot_missing_omits_section_gracefully(build) -> None:
    result = build(notes=ALL_NOTES)
    assert result.feed_problems == ("feeds snapshot is missing",)
    elsewhere = (result.out / "elsewhere" / "index.html").read_text(encoding="utf-8")
    assert "Earwurmz of Whimsy" in elsewhere
    assert "aren't listed here right now" in elsewhere
    assert check_site(result.out) == []


def test_invalid_feed_snapshot_is_ignored(build, tmp_path: Path) -> None:
    content = tmp_path / "content"
    (content / "notes").mkdir(parents=True)
    (content / "notes" / "first-note.md").write_text(PUBLISHED_NOTE, encoding="utf-8")
    feeds = content / "feeds.json"
    feeds.write_text("{not json", encoding="utf-8")
    result = build_site(
        out=tmp_path / "dist",
        content_dir=content,
        templates_dir=REPO / "templates",
        static_dir=REPO / "static",
        feeds_file=feeds,
        commit=COMMIT,
        today=TODAY,
    )
    assert result.feed_problems and "unreadable" in result.feed_problems[0]
    assert check_site(result.out) == []


def test_feed_titles_are_escaped(build) -> None:
    feeds = json.loads(json.dumps(DEFAULT_FEEDS))
    feeds["sources"]["substack"]["items"][0]["title"] = "Post <script>alert(1)</script>"
    result = build(notes=ALL_NOTES, feeds=feeds)
    html = (result.out / "elsewhere" / "index.html").read_text(encoding="utf-8")
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_external_canonical_is_excluded_from_sitemap(build) -> None:
    note = PUBLISHED_NOTE.replace(
        "status: published",
        "status: published\ncanonical: https://example.substack.com/p/reprint",
    )
    result = build(notes={"reprint.md": note}, feeds=DEFAULT_FEEDS)
    sitemap = (result.out / "sitemap.xml").read_text(encoding="utf-8")
    assert "/notes/reprint/" not in sitemap
    html = (result.out / "notes" / "reprint" / "index.html").read_text(encoding="utf-8")
    assert (
        '<link rel="canonical" href="https://example.substack.com/p/reprint">' in html
    )


def test_output_directory_must_be_marked_before_deletion(tmp_path: Path) -> None:
    unmarked = tmp_path / "important"
    unmarked.mkdir()
    (unmarked / "keep.txt").write_text("do not delete", encoding="utf-8")
    with pytest.raises(BuildError, match="refusing to delete"):
        prepare_output(unmarked)
    assert (unmarked / "keep.txt").exists()


def test_output_cannot_be_inside_content(tmp_path: Path) -> None:
    content = tmp_path / "content"
    content.mkdir()
    with pytest.raises(BuildError, match="refusing to write output inside"):
        prepare_output(content / "dist", protected=(content,))


def test_output_cannot_be_the_repository_root() -> None:
    with pytest.raises(BuildError):
        prepare_output(Path("/"))


def test_rebuild_removes_stale_files(build) -> None:
    first = build(notes=ALL_NOTES, feeds=DEFAULT_FEEDS)
    stale = first.out / "notes" / "first-note" / "index.html"
    assert stale.is_file()
    second = build(notes={}, feeds=DEFAULT_FEEDS)
    assert not stale.exists()
    assert second.out == first.out

