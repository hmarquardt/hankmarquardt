"""Site constants and filesystem layout.

Everything here is static: no environment-specific values are read at import
time, so the same inputs always produce the same build.
"""

from __future__ import annotations

from pathlib import Path

SITE_NAME = "Hank Marquardt"
SITE_ORIGIN = "https://hankmarquardt.com"
SITE_APEX = "hankmarquardt.com"
SITE_TAGLINE = "Still building. Just with better tools."
SITE_DESCRIPTION = (
    "Hank Marquardt is an experienced software engineer and independent builder "
    "working on AI, software, and the natural world."
)
SITE_LANGUAGE = "en"

# Public destinations verified during the migration (see README).
GITHUB_URL = "https://github.com/hmarquardt"
YOUTUBE_CHANNEL_URL = "https://www.youtube.com/channel/UC_D3lgvy2XWLEZ1Uw4IU9Rg"
SUBSTACK_URL = "https://hankmarquardt.substack.com"
CONTACT_EMAIL = "hmarquardt@gmail.com"
CONTACT_EMAIL_URL = "mailto:hmarquardt@gmail.com"

ROOT = Path(__file__).resolve().parent.parent
CONTENT_DIR = ROOT / "content"
NOTES_DIR = CONTENT_DIR / "notes"
FEEDS_FILE = CONTENT_DIR / "feeds.json"
TEMPLATES_DIR = ROOT / "templates"
STATIC_DIR = ROOT / "static"

# The only top-level paths the build will delete and repopulate.
OUTPUT_MARKER = ".site-build-output"

# The owner authorized one client-side script on 2026-10-27: CFLab Analytics. It is
# first-party and cookieless (a sessionStorage session id, no cookie, no persistent
# identifier, DNT/GPC honoured), and it posts reduced pageview data to the Analytics
# Worker. Nothing else may execute on these pages: the allowlist is enforced by
# sitegen/checks.py, tests/test_build.py, scripts/verify_production.py and the CSP in
# src/worker.mjs. Changing the id or the origin means changing all of them together.
ANALYTICS_ORIGIN = "https://analytics.aismallbizguru.com"
ANALYTICS_SCRIPT_URL = f"{ANALYTICS_ORIGIN}/script.js"
ANALYTICS_SITE_ID = "as_LSLKDIyn2pzUxJFLdLjLhj"

NAV = (
    ("/work/", "Work"),
    ("/notes/", "Field Notes"),
    ("/about/", "About"),
    ("/elsewhere/", "Elsewhere"),
)
