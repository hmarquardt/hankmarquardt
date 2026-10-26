"""Guard the production smoke-test script itself."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from conftest import DRAFT_NOTE, PUBLISHED_NOTE, REPO

SPEC = importlib.util.spec_from_file_location(
    "verify_production", REPO / "scripts" / "verify_production.py"
)
assert SPEC and SPEC.loader
verify_production = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verify_production)


def test_draft_slugs_lists_only_drafts(tmp_path: Path) -> None:
    notes = tmp_path / "notes"
    notes.mkdir()
    (notes / "first-note.md").write_text(PUBLISHED_NOTE, encoding="utf-8")
    (notes / "secret-draft.md").write_text(DRAFT_NOTE, encoding="utf-8")
    assert verify_production.draft_slugs(tmp_path) == ["secret-draft"]


def test_draft_slugs_handles_missing_directory(tmp_path: Path) -> None:
    assert verify_production.draft_slugs(tmp_path / "nothing") == []


def test_main_refuses_to_run_without_a_commit() -> None:
    assert verify_production.main(["--commit", ""]) == 2
