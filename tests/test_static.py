"""Stylesheet sanity: the site is one CSS file, and it must stay well-formed."""

from __future__ import annotations

import re

from conftest import REPO

CSS = (REPO / "static" / "styles.css").read_text(encoding="utf-8")
AT_RULES = ("@media", "@supports", "@layer", "@keyframes", "@font-face", "@page")


def _selectors() -> list[tuple[str | None, str]]:
    """Return (parent selector, selector) for every rule opener in file order."""

    stack: list[str] = []
    found: list[tuple[str | None, str]] = []
    buffer = ""
    for char in CSS:
        if char == "{":
            lines = [line.strip() for line in buffer.strip().splitlines() if line.strip()]
            selector = lines[-1] if lines else ""
            found.append((stack[-1] if stack else None, selector))
            stack.append(selector)
            buffer = ""
        elif char == "}":
            if not stack:
                raise AssertionError("unbalanced closing brace in styles.css")
            stack.pop()
            buffer = ""
        else:
            buffer += char
    if stack:
        raise AssertionError("unclosed block in styles.css")
    return found


def test_braces_balance() -> None:
    assert CSS.count("{") == CSS.count("}")


def test_rules_are_not_accidentally_nested() -> None:
    """Only at-rules may contain other rules; a stray brace must fail the suite."""

    selectors = _selectors()
    assert selectors, "no CSS rules found"
    nested = [
        (parent, selector)
        for parent, selector in selectors
        if parent is not None and not parent.startswith(AT_RULES)
    ]
    assert nested == [], f"accidentally nested rules: {nested[:3]}"


def test_stylesheet_has_no_unknown_custom_properties() -> None:
    defined = set(re.findall(r"^\s*(--[a-z-]+):", CSS, re.MULTILINE))
    used = set(re.findall(r"var\((--[a-z-]+)", CSS))
    assert used <= defined, f"undefined custom properties: {sorted(used - defined)}"


def test_stylesheet_has_no_inline_url_dependencies() -> None:
    assert "url(" not in CSS, "keep the stylesheet free of external asset references"
