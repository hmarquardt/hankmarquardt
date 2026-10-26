"""Errors raised while reading content or writing the build."""

from __future__ import annotations


class SiteError(Exception):
    """Base error for the site build."""


class ContentError(SiteError):
    """Content is invalid: the build must stop rather than publish it."""


class BuildError(SiteError):
    """The build cannot proceed safely (for example, an unsafe output path)."""
