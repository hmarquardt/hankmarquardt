# hankmarquardt.com

The static personal site for Hank Marquardt: an editorial homepage, a curated work
list, Field Notes rendered from Markdown, an about page, and verified links to
Earwurmz of Whimsy and Substack.

- Hosting: Cloudflare Workers Static Assets (one small Worker for canonical host
  redirects and security headers)
- Build: Python 3.13 + uv + Jinja2 + markdown-it-py + PyYAML
- Runtime: no database, no CMS, no framework, no npm runtime dependencies, no client
  JavaScript, no analytics
- Deploy: push to `main` → GitHub Actions validates, builds, deploys, verifies the live
  revision

```
content/notes/*.md     Field Notes source (front matter + Markdown)
content/feeds.json     committed snapshot of the YouTube/Substack feeds
sitegen/               build code (content model, feeds, render, checks, CLI)
templates/             Jinja2 templates (autoescaped)
static/                styles.css, favicon.svg, future images
src/worker.mjs         host canonicalisation, legacy redirects, security headers
wrangler.json          Worker + static asset configuration
tests/                 pytest suites and Node Worker tests
scripts/               production smoke test
dist/                  generated output (ignored by git)
```

## Local development

Requirements: [uv](https://docs.astral.sh/uv/), Node.js 24+ (for Wrangler only).
No global npm install is needed.

```sh
uv sync --locked                    # create .venv from uv.lock
uv run python -m sitegen build      # render dist/ and run structural checks
uv run pytest                       # content, build, feed and safety suites
node --test tests/worker.test.mjs   # Worker redirect and header tests
```

Preview the built files:

```sh
# Fast, no Worker: no redirects or security headers, but instant.
uv run python -m http.server 8000 --directory dist

# Faithful: the real Worker, assets binding, 404 handling and headers.
npx --yes wrangler@4.153.0 dev --ip 127.0.0.1 --host localhost --port 8787
```

`--host localhost` matters: without it, Wrangler derives the dev hostname from the
custom domain routes and redirects every request. Pinning the Wrangler version keeps
local previews and CI on the same toolchain.

## Publishing a Field Note

1. Create `content/notes/<slug>.md`. The filename **is** the URL: `/notes/<slug>/`.
   Slugs are lowercase letters, digits and single hyphens; `index`, `feed`, `notes`,
   `sitemap` and `404` are reserved.
2. Write the front matter exactly:

   ```yaml
   ---
   title: "A title under 120 characters"
   date: 2026-11-02
   description: "One or two sentences, 40–320 characters, used for metadata and the feed."
   tags: [cloudflare, static sites]
   status: draft
   canonical: https://example.com/original   # optional, https only
   ---
   ```

   Unknown keys, duplicate keys, missing keys, a description outside 40–320
   characters, and a body-less file all fail the build. A *published* note dated in
   the future also fails rather than appearing early.
3. `uv run python -m sitegen build` — drafts are validated but never written,
   indexed, fed or sitemapped.
4. Review `dist/notes/<slug>/index.html` in the local preview.
5. Set `status: published`, rebuild, and push. Only published notes generate an
   article page, a notes-index entry, an RSS item and a sitemap entry.

Markdown is CommonMark plus tables. Raw HTML is escaped, not executed; link and
image targets are validated after parsing; external images are refused (put images
in `static/` and reference them as `/images/...`); every external link gains
`rel="noopener noreferrer"`; heading ids are generated and de-duplicated.

Draft files stay in the repository. A note is unpublished, not deleted, until the
author decides otherwise.

## Feed snapshots (YouTube / Substack)

`content/feeds.json` is a committed, validated snapshot of the newest videos and
Substack posts. The build never touches the network, so a feed outage can never
break a deploy; if the snapshot is missing or invalid, the Elsewhere page keeps the
channel and publication links and omits the item lists.

Refresh it deliberately, review the diff, and commit:

```sh
uv run python -m sitegen refresh-feeds
```

The command keeps the previous snapshot for a source whose fetch fails, normalises
dates to `YYYY-MM-DD`, caps each list, and only accepts `https` URLs on an allowlist
of hosts (`youtube.com`, `hankmarquardt.substack.com`). It refuses XML with a

## Deployment

Target: Cloudflare account `b1aa310aa0a1638d72b8b086a21e557c`, Worker
`hankmarquardt`, zone `hankmarquardt.com` (`1d02b937540d58cb201c4abcbb7df4d1`).
The Worker serves `hankmarquardt.com` and `www.hankmarquardt.com`; www is a permanent
redirect to the apex, and `http` is upgraded to `https`. `/youtube`, `/substack` and
`/home` redirect to their replacements.

`.github/workflows/site.yml` is the only production pipeline:

- **validate** (every push and pull request): locked dependency install, pytest,
  build with structural checks, Node Worker tests, `wrangler deploy --dry-run`.
- **deploy** (push to `main` only): requires the repository secret
  `CLOUDFLARE_API_TOKEN`, rebuilds the same commit, deploys, then runs
  `scripts/verify_production.py`, which checks the live `version.json` commit, pages,
  security headers, canonical URLs, the 404 page, www/http/legacy redirects and the
  absence of every draft slug.

Unattended deployment is gated by the repository variable
`CLOUDFLARE_DEPLOY_ENABLED`. Until it is `true` **and** the secret exists, pushes to
`main` validate and stop; the workflow summary says so explicitly. To enable:

```sh
gh secret set CLOUDFLARE_API_TOKEN      # paste a scoped, account-owned token
gh variable set CLOUDFLARE_DEPLOY_ENABLED --body true
```

The token needs exactly: Workers Scripts:Edit, Workers Routes:Edit, Account
Settings:Read, Zone:Read, SSL and Certificates:Edit for `hankmarquardt.com`. It is
never committed, printed, or used by the browser. A local Wrangler OAuth login may be
used to bootstrap the Worker once; it must not be copied into GitHub, because it is a
rotating personal credential.

Manual verification at any time:

```sh
uv run python scripts/verify_production.py --commit "$(git rev-parse HEAD)"
```

## Rollback

Three independent levers, in order of preference:

1. **Git revert** — `git revert <bad-commit>` and push. CI validates and deploys the
   previous content; history is never rewritten and no force push is needed.
2. **Cloudflare version rollback** — `npx wrangler@4.153.0 versions list`, then
   `npx wrangler@4.153.0 rollback <version-id>` to restore the previously active
   Worker version immediately.
3. **Disable deployment** — `gh variable set CLOUDFLARE_DEPLOY_ENABLED --body false`
   stops push-to-main releases while the problem is investigated. The live site keeps
   serving its current version.

## Troubleshooting

- **Build refuses to delete the output directory.** It only removes a directory it
  created (marked with `.site-build-output`). Delete `dist/` yourself, or pass
  `--out` a new path.
- **`published notes cannot be dated in the future`.** The front matter date is later
  than today; correct the date or leave the note as a draft.
- **A note is missing from the site.** Check `status: published`, that the filename is
  a valid slug, and the build output line `drafts excluded: …`.
- **The Elsewhere page has no video or post list.** `content/feeds.json` is missing or
  failed validation; run the refresh command.
- **`wrangler dev` redirects every request.** Pass `--host localhost`.
- **Production verification fails on the revision.** The deploy may not have
  propagated; the script retries six times. If it still fails, confirm the GitHub
  Actions deploy job succeeded and that `CLOUDFLARE_API_TOKEN` belongs to the account
  in `wrangler.json`.
- **A path 404s that used to work.** Add a permanent redirect in
  `LEGACY_PATHS` (`src/worker.mjs`) and a case in `tests/worker.test.mjs`; do not
  quietly reuse the path for different content.

## Security and privacy

- Static output only. No cookies, no localStorage, no analytics, no third-party
  scripts, no inline event handlers, no `<script>` tags at all.
- CSP `default-src 'none'; style-src 'self'; img-src 'self'; ...; frame-ancestors
  'none'`, plus HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, COOP and CORP, attached by the Worker to
  every response (including redirects and 404s).
- Content validation: unknown front matter keys, duplicate YAML keys, unsafe URL
  schemes (`javascript:`, `data:`, `vbscript:`), protocol-relative links, credential
  URLs, path traversal and duplicate slugs are refused before rendering.
- Drafts are excluded by construction and the release check probes their URLs in
  production.
- No secrets exist in this repository. `.env*`, `.dev.vars*`, keys, credentials and
  `dist/` are ignored.

## Migration from the Streamlit app

The previous site was a Streamlit multipage app (`app.py`, `views/home.py`,
`views/home.html`, `views/youtube.py`, `views/substack.py`, `.streamlit/config.toml`).
It was removed in this repository's history, not rewritten: no force push, no history
rewrite. The old app was served from `hankmarquardt.streamlit.app`, a different
origin, so there were no old URLs on `hankmarquardt.com` to preserve (the zone had no
web records before this site). The defensive `/youtube`, `/substack` and `/home`
redirects exist for links people may have saved.

Retained: the YouTube channel, the Substack publication, the biography facts the old
homepage stated (web development, data engineering, AI work and interest).

Deliberately not carried over: the Salida, Colorado residency line (stale, unverified),
the Streamlit runtime, and the unescaped remote HTML those pages injected.

## Editorial rules for this site

- No invented career claims, metrics, testimonials, endorsements, dates or project
  features. Every work description is limited to what the linked public project shows.
- No fabricated headshots or screenshots; the design is typographic.
- Drafts are clearly labelled `status: draft` and never published from CI.
- Private and family projects are out of scope, and confidential client/infrastructure
  details are not described.

doctype or entity declaration.
