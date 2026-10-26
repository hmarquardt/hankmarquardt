"""Shared fixtures: a small content tree and a build helper."""

from __future__ import annotations

import json
import shutil
from datetime import date
from pathlib import Path

import pytest

from sitegen.build import build_site

REPO = Path(__file__).resolve().parents[1]
TODAY = date(2026, 10, 26)
COMMIT = "a" * 40

PUBLISHED_NOTE = """---
title: "The First Note"
date: 2026-09-01
description: "A published note used by the tests to prove that rendering, feeds and the sitemap agree."
tags: [Testing, build]
status: published
---

## A heading

Body text with an [internal link](/work/) and an external [site](https://example.com/page).

## A heading

More text, and a `code span`.
"""

DRAFT_NOTE = """---
title: "Secret Draft Title"
date: 2026-10-20
description: "A draft note used by the tests to prove that unpublished content never reaches the build output."
tags: [testing]
status: draft
---

DRAFT-SECRET-MARKER: this text must never be published.
"""

DEFAULT_FEEDS = {
    "schema": 1,
    "refreshed": "2026-10-26",
    "sources": {
        "youtube": {
            "label": "Earwurmz of Whimsy",
            "url": "https://www.youtube.com/channel/UC_D3lgvy2XWLEZ1Uw4IU9Rg",
            "items": [
                {
                    "title": "Turkey Vultures in the Sky",
                    "url": "https://www.youtube.com/watch?v=WIpdHBTiNl4",
                    "published": "2026-10-26",
                }
            ],
        },
        "substack": {
            "label": "Hank Marquardt",
            "url": "https://hankmarquardt.substack.com",
            "items": [
                {
                    "title": "10MB to 1T, $5000 to $100, Wow :)",
                    "url": "https://hankmarquardt.substack.com/p/10mb-to-1t-5000-to-100-wow",
                    "published": "2026-10-01",
                }
            ],
        },
    },
}


@pytest.fixture
def site_factory(tmp_path: Path):
    """Create a content tree; returns a (content_dir, feeds_path) pair."""

    def make(
        *,
        notes: dict[str, str] | None = None,
        feeds: object | None = None,
        directory: Path | None = None,
    ) -> tuple[Path, Path | None]:
        root = directory or tmp_path
        content = root / "content"
        notes_dir = content / "notes"
        if notes_dir.exists():
            shutil.rmtree(notes_dir)
        notes_dir.mkdir(parents=True, exist_ok=True)
        for name, text in (notes if notes is not None else {"first-note.md": PUBLISHED_NOTE}).items():
            (notes_dir / name).write_text(text, encoding="utf-8")
        feeds_path = content / "feeds.json"
        if feeds is not None:
            feeds_path.write_text(json.dumps(feeds), encoding="utf-8")
        return content, (feeds_path if feeds is not None else None)

    return make


@pytest.fixture
def build(site_factory):
    """Build the default fixture site and return the result."""

    def make(*, notes=None, feeds=None, directory: Path | None = None, commit: str = COMMIT):
        content, feeds_path = site_factory(notes=notes, feeds=feeds, directory=directory)
        out = (directory or content.parent) / "dist"
        return build_site(
            out=out,
            content_dir=content,
            templates_dir=REPO / "templates",
            static_dir=REPO / "static",
            feeds_file=feeds_path,
            commit=commit,
            today=TODAY,
        )

    return make
