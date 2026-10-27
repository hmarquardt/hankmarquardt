"""The structural checker must actually catch the failures it claims to catch."""

from __future__ import annotations

from pathlib import Path

from conftest import DEFAULT_FEEDS, PUBLISHED_NOTE

from sitegen.checks import check_site, resolve_internal
from sitegen.config import ANALYTICS_SCRIPT_URL, ANALYTICS_SITE_ID


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


ANALYTICS_TAG = f'<script defer src="{ANALYTICS_SCRIPT_URL}" data-site="{ANALYTICS_SITE_ID}"></script>'


def _mutate(build, relative: str, change) -> list[str]:
    out = build_ok(build)
    path = out / relative
    path.write_text(change(path.read_text(encoding="utf-8")), encoding="utf-8")
    return check_site(out)


def test_an_inline_script_is_reported(build) -> None:
    problems = _mutate(
        build, "index.html", lambda html: html.replace("</body>", "<script>alert(1)</script></body>")
    )
    assert any("unapproved client JavaScript" in problem for problem in problems)


def test_a_script_from_another_origin_is_reported(build) -> None:
    problems = _mutate(
        build,
        "index.html",
        lambda html: html.replace(ANALYTICS_TAG, ANALYTICS_TAG.replace(ANALYTICS_SCRIPT_URL, "https://tracker.example/x.js")),
    )
    assert any("unapproved client JavaScript" in problem for problem in problems)


def test_the_analytics_tag_with_the_wrong_site_id_is_reported(build) -> None:
    problems = _mutate(build, "index.html", lambda html: html.replace(ANALYTICS_SITE_ID, "as_AAAAAAAAAAAAAAAAAAAAAA"))
    assert any("unapproved client JavaScript" in problem for problem in problems)
    assert any("expected exactly one approved analytics script, found 0" in problem for problem in problems)


def test_an_analytics_tag_with_an_extra_attribute_is_reported(build) -> None:
    problems = _mutate(
        build, "index.html",
        lambda html: html.replace(ANALYTICS_TAG, ANALYTICS_TAG.replace(" defer", ' defer nonce="x"')),
    )
    assert any("unapproved client JavaScript" in problem for problem in problems)


def test_a_duplicate_analytics_tag_is_reported(build) -> None:
    problems = _mutate(build, "index.html", lambda html: html.replace("</body>", ANALYTICS_TAG + "</body>"))
    assert any("expected exactly one approved analytics script, found 2" in problem for problem in problems)


def test_the_404_page_must_not_load_analytics(build) -> None:
    problems = _mutate(build, "404.html", lambda html: html.replace("</body>", ANALYTICS_TAG + "</body>"))
    assert any("the 404 page must not load analytics" in problem for problem in problems)


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
    notes = (out / "notes" / "index.html").read_text(encoding="utf-8")
    assert "application/ld+json" not in notes
    assert notes.count(ANALYTICS_TAG) == 1


def test_malformed_person_schema_is_reported(build) -> None:
    out = build_ok(build)
    index = out / "index.html"
    html = index.read_text(encoding="utf-8")
    index.write_text(html.replace('"@type": "Person"', '"@type": "Product"'), encoding="utf-8")
    assert any("invalid Person structured data" in item for item in check_site(out))
