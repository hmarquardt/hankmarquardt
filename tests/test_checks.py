"""The structural checker must actually catch the failures it claims to catch."""

from __future__ import annotations

from pathlib import Path

from conftest import DEFAULT_FEEDS, PUBLISHED_NOTE

from sitegen.checks import check_site, resolve_internal


def build_ok(build) -> Path:
    return build(notes={"first-note.md": PUBLISHED_NOTE}, feeds=DEFAULT_FEEDS).out


def test_clean_build_has_no_problems(build) -> None:
    assert check_site(build_ok(build)) == []


def test_missing_canonical_is_reported(build) -> None:
    out = build_ok(build)
    index = out / "index.html"
    index.write_text(
        index.read_text(encoding="utf-8").replace(
            '<link rel="canonical" href="https://hankmarquardt.com/">', ""
        ),
        encoding="utf-8",
    )
    assert any("missing canonical" in problem for problem in check_site(out))


def test_broken_internal_link_is_reported(build) -> None:
    out = build_ok(build)
    index = out / "index.html"
    index.write_text(
        index.read_text(encoding="utf-8").replace('href="/work/"', 'href="/nope/"', 1),
        encoding="utf-8",
    )
    assert any("link target does not exist" in problem for problem in check_site(out))


def test_script_tag_is_reported(build) -> None:
    out = build_ok(build)
    index = out / "index.html"
    index.write_text(
        index.read_text(encoding="utf-8").replace("</body>", "<script>alert(1)</script></body>"),
        encoding="utf-8",
    )
    problems = check_site(out)
    assert any("no client JavaScript" in problem for problem in problems)


def test_duplicate_id_is_reported(build) -> None:
    out = build_ok(build)
    index = out / "index.html"
    index.write_text(
        index.read_text(encoding="utf-8").replace('id="main"', 'id="hero-title"', 1),
        encoding="utf-8",
    )
    problems = check_site(out)
    assert any("duplicate id" in problem for problem in problems)
    assert any('missing <main id="main">' in problem for problem in problems)


def test_draft_reference_is_reported(build) -> None:
    out = build_ok(build)
    index = out / "index.html"
    index.write_text(
        index.read_text(encoding="utf-8").replace(
            "</main>", '<p><a href="/notes/secret-draft/">draft</a></p></main>'
        ),
        encoding="utf-8",
    )
    assert any("draft note is referenced" in problem for problem in check_site(out, draft_slugs=("secret-draft",)))


def test_missing_image_is_reported(build) -> None:
    out = build_ok(build)
    index = out / "index.html"
    index.write_text(
        index.read_text(encoding="utf-8").replace(
            "</main>", '<p><img src="/images/missing.webp" alt="x"></p></main>'
        ),
        encoding="utf-8",
    )
    assert any("image does not exist" in problem for problem in check_site(out))


def test_legacy_streamlit_copy_is_reported(build) -> None:
    out = build_ok(build)
    index = out / "index.html"
    index.write_text(
        index.read_text(encoding="utf-8").replace("</main>", "<p>Built with Streamlit</p></main>"),
        encoding="utf-8",
    )
    assert any("legacy Streamlit" in problem for problem in check_site(out))


def test_insecure_external_link_is_reported(build) -> None:
    out = build_ok(build)
    index = out / "index.html"
    index.write_text(
        index.read_text(encoding="utf-8").replace(
            "</main>", '<p><a href="http://example.com">x</a></p></main>'
        ),
        encoding="utf-8",
    )
    assert any("insecure" in problem for problem in check_site(out))


def test_resolve_internal_refuses_traversal(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("x", encoding="utf-8")
    assert resolve_internal(dist, "/../outside.html") is None
    assert resolve_internal(dist, "https://example.com/") is None
    assert resolve_internal(dist, "/index.html") == (dist / "index.html").resolve()



def test_person_schema_on_home_and_about(build) -> None:
    import json
    import re

    out = build_ok(build)
    for relative in ("index.html", "about/index.html"):
        html = (out / relative).read_text(encoding="utf-8")
        blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
        assert len(blocks) == 1
        data = json.loads(blocks[0])
        assert data["@type"] == "Person"
        assert data["name"] == "Hank Marquardt"
        assert data["url"] == "https://hankmarquardt.com/"
    assert '<script' not in (out / "notes" / "index.html").read_text(encoding="utf-8")


def test_malformed_person_schema_is_reported(build) -> None:
    out = build_ok(build)
    index = out / "index.html"
    html = index.read_text(encoding="utf-8")
    index.write_text(html.replace('"@type": "Person"', '"@type": "Product"'), encoding="utf-8")
    assert any("invalid Person structured data" in item for item in check_site(out))
