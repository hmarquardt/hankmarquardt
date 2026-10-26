"""Smoke-test the deployed site over HTTPS.

Run after a deployment (CI does this automatically):

    uv run python scripts/verify_production.py --commit "$GITHUB_SHA"

It checks the revision, key pages, security headers, canonical redirects, the
404 page, and that draft notes do not exist in production. It exits non-zero on
any failure so a release is never declared successful on trust.
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SITE = "https://hankmarquardt.com"
APEX_HOST = "hankmarquardt.com"
HEADERS = {"User-Agent": "hankmarquardt-release-check/1.0", "Cache-Control": "no-cache"}
TIMEOUT = 20


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def fetch(url: str, *, method: str = "GET") -> tuple[int, dict[str, str], str]:
    request = urllib.request.Request(url, method=method, headers=HEADERS)
    try:
        with OPENER.open(request, timeout=TIMEOUT, context=ssl.create_default_context()) as response:
            body = response.read(512_000).decode("utf-8", "replace") if method != "HEAD" else ""
            return response.status, {k.lower(): v for k, v in response.headers.items()}, body
    except urllib.error.HTTPError as error:
        body = error.read(512_000).decode("utf-8", "replace") if method != "HEAD" else ""
        return error.code, {k.lower(): v for k, v in error.headers.items()}, body


def draft_slugs(content_dir: Path) -> list[str]:
    slugs: list[str] = []
    notes = content_dir / "notes"
    if not notes.is_dir():
        return slugs
    for path in sorted(notes.glob("*.md")):
        text = "\n" + path.read_text(encoding="utf-8").replace("\r\n", "\n")
        if "\nstatus: draft" in text:
            slugs.append(path.stem)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", default=os.environ.get("SITE_URL", SITE))
    parser.add_argument("--commit", default=os.environ.get("GITHUB_SHA", ""))
    parser.add_argument("--content", type=Path, default=Path("content"))
    parser.add_argument("--retries", type=int, default=6)
    parser.add_argument("--retry-delay", type=float, default=5.0)
    args = parser.parse_args(argv)

    site = args.site.rstrip("/")
    expected = args.commit.strip()
    failures: list[str] = []

    if not expected:
        print("error: pass --commit or set GITHUB_SHA", file=sys.stderr)
        return 2

    revision = None
    for attempt in range(args.retries):
        try:
            status, _, body = fetch(f"{site}/version.json")
            if status == 200:
                revision = json.loads(body).get("commit")
                if revision == expected:
                    break
        except (urllib.error.URLError, json.JSONDecodeError, OSError) as error:
            if attempt == args.retries - 1:
                print(f"error: cannot reach {site}: {error}", file=sys.stderr)
                return 2
        if attempt < args.retries - 1:
            time.sleep(args.retry_delay)

    if revision != expected:
        failures.append(f"/version.json reports {revision!r}, expected {expected!r}")

    for path in ("/", "/work/", "/notes/", "/about/", "/elsewhere/"):
        status, headers, body = fetch(f"{site}{path}")
        if status != 200:
            failures.append(f"{path}: expected 200, got {status}")
            continue
        csp = headers.get("content-security-policy", "")
        if "frame-ancestors 'none'" not in csp or "default-src 'none'" not in csp:
            failures.append(f"{path}: security headers are missing")
        if headers.get("x-content-type-options") != "nosniff":
            failures.append(f"{path}: missing nosniff")
        if headers.get("strict-transport-security") is None:
            failures.append(f"{path}: missing HSTS")
        if "<script" in body.lower():
            failures.append(f"{path}: client JavaScript found")
        if f'<link rel="canonical" href="{site}{path}"' not in body:
            failures.append(f"{path}: canonical link is missing or wrong")

    for path, needle in (
        ("/robots.txt", "Sitemap: https://hankmarquardt.com/sitemap.xml"),
        ("/sitemap.xml", "<urlset"),
        ("/notes/feed.xml", "<rss"),
        ("/styles.css", "--paper"),
        ("/favicon.svg", "<svg"),
    ):
        status, headers, body = fetch(f"{site}{path}")
        if status != 200:
            failures.append(f"{path}: expected 200, got {status}")
        elif needle not in body:
            failures.append(f"{path}: expected content is missing")
        if path == "/notes/feed.xml" and headers.get("content-type", "").startswith("text/html"):
            failures.append("/notes/feed.xml: served as HTML")

    status, _, body = fetch(f"{site}/this-page-does-not-exist")
    if status != 404:
        failures.append(f"missing page: expected 404, got {status}")
    elif "This page isn't here." not in body:
        failures.append("404 page: custom copy is missing")

    status, headers, _ = fetch(f"https://www.{APEX_HOST}/work/?ref=test")
    expected_location = f"{site}/work/?ref=test"
    if status not in {301, 308} or headers.get("location") != expected_location:
        failures.append(
            f"www redirect: expected 301/308 to {expected_location}, "
            f"got {status} {headers.get('location')!r}"
        )

    status, headers, _ = fetch(f"http://{APEX_HOST}/")
    if status not in {301, 308} or not (headers.get("location") or "").startswith("https://"):
        failures.append(f"http upgrade: got {status} {headers.get('location')!r}")

    status, headers, _ = fetch(f"{site}/youtube")
    if status not in {301, 308} or headers.get("location") != f"{site}/elsewhere/":
        failures.append(f"legacy /youtube: got {status} {headers.get('location')!r}")

    slugs = draft_slugs(args.content)
    for slug in slugs:
        status, _, _ = fetch(f"{site}/notes/{slug}/")
        if status != 404:
            failures.append(f"draft note {slug!r} is reachable in production ({status})")

    source, _, _ = fetch(f"{site}/")
    for slug in slugs:
        if slug in source:
            failures.append(f"draft slug {slug!r} appears on the homepage")

    if failures:
        print(f"{len(failures)} production check(s) failed at {site}:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print(f"Verified {site} at commit {expected}: pages, headers, 404, redirects, drafts absent.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
