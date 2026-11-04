# Deep Cuts

A private, mobile-first listening room for personally owned music. An independent
PWA in the `hmarquardt/hankmarquardt` repository. Intended production origin:
**https://deepcuts.hankmarquardt.com**. The first production release is live; see
the [production release record](docs/PRODUCTION.md) for the deployed revision,
verification, authentication-key location and remaining limitations.

## Run locally

Node 24 LTS is the CI baseline. Node 26 also works locally.

```sh
cd deepcuts
npm ci
npx playwright install chromium
npm run dev
```

Open **http://127.0.0.1:8788**. `npm run setup` (also run by `dev`) creates a
random local owner access key in the ignored `.dev.vars` file with mode `0600`.
Copy that value into the sign-in form. Do not reuse it on preview or production.
This file is the only local secret; no default credential is committed.

`dev` builds the PWA, applies **local** D1 migrations, and starts the real Worker
with local D1/R2 emulation. It never contacts production storage. Re-run it after
frontend edits; this intentionally tests the built PWA rather than a separate
frontend development server. Use the exact loopback origin above for cookie and
Origin checks. A service worker update takes effect after existing app tabs close.

To try a complete album without supplying any real music:

```sh
npm run fixtures
```

Import the three generated files in `fixtures/generated/` together. They contain
soft synthetic tones, fictional tags, and original procedural embedded artwork.
The files are generated locally and ignored. No recordings or private library
metadata are committed.

## What works

- Responsive library, album detail, local downloads, and search across album,
  artist and song names. Real empty states; no pretend personal collection.
- Private single-owner sign-in, opaque revocable HttpOnly session cookies,
  same-origin mutation checks, login rate limiting, security headers.
- One album per import: MP3, AAC/M4A and FLAC; browser metadata and embedded
  JPEG/PNG extraction; fallback fields and optional cover/folder image.
- File selection and an album-folder picker on browsers supporting directory input.
- Sequential original uploads to private R2, streaming SHA-256 and container
  verification, immutable object writes, and staged D1 metadata. Partial imports
  stay out of the library. Tracks up to 64 MiB with flat Worker memory.
- Playlists across albums: create, rename, delete, add, remove and reorder, with a
  mobile-first editor, an "add to playlist" action on every track, a library-wide
  track picker, play, shuffle and append-to-queue. Playlists reference existing
  track ids only, so music is never copied and removing a track never deletes it.
- Authenticated original-byte streaming, single HTTP byte ranges, suffix/open
  ranges, HEAD and If-Range. No transcoding or public/signed media URLs.
- Persistent audio element, seek, next/previous, add/remove/select queue items,
  local position/queue restoration, Media Session actions and metadata.
- Download an album and its art into IndexedDB, verify each original, report
  device storage, request persistence, verify again or remove a local album.
- Download a playlist without duplicating audio shared with downloaded albums;
  removing either collection keeps files the other still needs.
- Offline shell launch and album or playlist playback with **no API requests** and
  no server session dependency, including after a cold PWA reload. Sign out clears
  the collection and listening state on this device. Offline sign-out queues server
  revocation for the next online launch.
- Dedicated local/preview/production Worker configs; isolated validation and
  manually gated preview CI. No production deployment job.

## Checks

```sh
npm run check       # TypeScript, unit tests, PWA build, Worker dry-run bundle
npm run test:e2e    # real local Worker/D1/R2; mobile and desktop Chromium
```

Playwright generates the album and builds the PWA automatically, and uses separate
local storage under `.wrangler/e2e/<unique-run>/`. Keep port 8788 free when running it.
Screenshots and traces are in ignored `test-results/`; the HTML report is in
`playwright-report/`. Browser automation uses generated tones only. Do not run
capture/trace tooling against a personal library and upload the results to CI.

## Structure

```text
src/client/         React shell, importer, player, playlist UI, IndexedDB downloads
src/worker/         Hono API, owner sessions, streaming upload verification
src/shared/         library and playlist types, SHA-256, ranges, shuffle helpers
migrations/        additive D1 foundation (0001) and playlist indexes (0002)
public/            manifest, original vector app mark, robots policy
scripts/           local setup, generated fixtures, PWA build, preview guards
tests/unit/        range, upload, playlist, offline-helper and SQLite API tests
tests/browser/     real-browser import/playback/playlist/download/offline tests
wrangler*.json     independent environment identities and resource bindings
docs/              decisions, deployment procedure, milestone handoff
```

See [architecture and risks](docs/ARCHITECTURE.md), [deployment](docs/DEPLOYMENT.md),
and the [implementation handoff](docs/HANDOFF.md) for provisional behavior and next work.
