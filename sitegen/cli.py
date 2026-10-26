"""Command line entry point: ``python -m sitegen <command>``."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import config
from .build import build_site
from .checks import check_site
from .errors import SiteError
from .feeds import refresh_snapshot


def _build(args: argparse.Namespace) -> int:
    result = build_site(
        out=args.out,
        content_dir=args.content,
        templates_dir=args.templates,
        static_dir=args.static,
        feeds_file=args.feeds,
        commit=args.commit,
    )
    print(f"Built {len(result.pages)} outputs into {result.out}")
    print(f"  commit: {result.commit}")
    print(f"  published notes: {len(result.published)}")
    if result.drafts:
        names = ", ".join(note.slug for note in result.drafts)
        print(f"  drafts excluded: {len(result.drafts)} ({names})")
    for problem in result.feed_problems:
        print(f"  feed warning: {problem}")

    problems = check_site(
        result.out,
        draft_slugs=tuple(note.slug for note in result.drafts),
        published_slugs=tuple(note.slug for note in result.published),
    )
    if problems:
        print("Structural checks failed:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1
    print("Structural checks: ok")
    return 0


def _check(args: argparse.Namespace) -> int:
    problems = check_site(args.dist)
    if problems:
        print(f"{len(problems)} problem(s) in {args.dist}:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1
    print(f"{args.dist}: structural checks ok")
    return 0


def _refresh(args: argparse.Namespace) -> int:
    refreshed, failures = refresh_snapshot(args.feeds)
    for key in refreshed:
        print(f"refreshed: {key}")
    for failure in failures:
        print(f"kept the previous snapshot for {failure}", file=sys.stderr)
    print(f"snapshot: {args.feeds}")
    if failures and not refreshed:
        print("No feed could be refreshed; the committed snapshot is unchanged.", file=sys.stderr)
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="sitegen", description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    build = subparsers.add_parser("build", help="render the site into dist/")
    build.add_argument("--out", type=Path, default=config.ROOT / "dist")
    build.add_argument("--content", type=Path, default=config.CONTENT_DIR)
    build.add_argument("--templates", type=Path, default=config.TEMPLATES_DIR)
    build.add_argument("--static", type=Path, default=config.STATIC_DIR)
    build.add_argument("--feeds", type=Path, default=None)
    build.add_argument("--commit", default=None)
    build.set_defaults(handler=_build)

    check = subparsers.add_parser("check", help="check an existing build")
    check.add_argument("--dist", type=Path, default=config.ROOT / "dist")
    check.set_defaults(handler=_check)

    refresh = subparsers.add_parser("refresh-feeds", help="refresh content/feeds.json")
    refresh.add_argument("--feeds", type=Path, default=config.FEEDS_FILE)
    refresh.set_defaults(handler=_refresh)

    args = parser.parse_args(argv)
    try:
        return int(args.handler(args))
    except SiteError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
