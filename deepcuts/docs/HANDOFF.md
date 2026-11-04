# Upload and playlist milestone

The foundation below is still the deployment record. This milestone adds larger
track uploads and complete playlists; see [PRODUCTION](PRODUCTION.md) for the
release that carries it.

## Scope and execution plan

1. Inspect the import pipeline, shared size validation, request buffering, hash
   verification and R2 writes. **Complete.**
2. Raise the per-track ceiling safely by streaming the request body into R2
   through an incremental verifier instead of buffering 64 MiB in the Worker.
   **Complete.**
3. Build playlist create/rename/delete/add/remove/reorder APIs on the existing
   tables, with sessions, validation and referential integrity. **Complete.**
4. Build the mobile-first playlist browsing and editing interface on the existing
   track ids and player. **Complete.**
5. Add offline playlist downloads that reuse existing IndexedDB audio, keep files
   needed by other collections, and survive a cold PWA reload. **Complete.**
6. Expand unit, API and Playwright coverage; run the personal-site regression
   suite; release to production. **Complete.**

## Validation

| Check                                                      | Result                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| `npm run typecheck`                                        | Pass                                                      |
| `npm test`                                                 | 53 unit/API tests + 6 deployment/isolation tests pass     |
| `npm run test:e2e`                                         | 12 tests pass: Pixel 7 and desktop Chromium               |
| `npm run build`                                            | PWA bundle, public shell precache and PNG icons generated |
| `npm run bundle:check`                                     | Worker dry-run succeeds; nothing uploaded                 |
| `npm run format:check`                                     | Pass                                                      |
| Existing personal-site `uv run pytest`                     | 105 pass                                                  |
| Existing personal-site `node --test tests/worker.test.mjs` | 13 pass                                                   |
| Existing personal-site `uv run python -m sitegen build`    | Pass, including structural checks                         |

New upload coverage includes a real 38 MiB streamed upload, exact-limit and
one-byte-over manifest boundaries, short and long bodies, digest mismatch,
non-audio contents, an interrupted stream followed by a clean retry, missing or
wrong `Content-Length`, and non-overwrite behavior on conflicting objects and
retries. Playlist coverage includes lifecycle, validation, cross-album membership,
duplicate rejection, staging-track rejection, ordering, stale reorder rejection,
removal compaction, playlist deletion isolation and 401s on every route. Browser
coverage adds playlist create/add/reorder/rename/play/shuffle/queue/remove,
playlist deletion keeping the library, and a download → offline reload → playback
flow that asserts shared audio is stored once and zero API requests are made.

# Foundation handoff

The foundation handoff below records the original local-only milestone. The owner
subsequently authorized direct production deployment without a hosted preview.
That release is now live at **https://deepcuts.hankmarquardt.com**. See the
[production release record](PRODUCTION.md) for current deployment status and
production verification. Physical-device acceptance remains deferred.

## Scope and execution plan

1. Inspect the repository, production deployment, and CFLab patterns. **Complete.**
2. Create an isolated Worker/D1/R2 application and owner sessions. **Complete locally.**
3. Connect import → original storage → authenticated playback. **Complete locally.**
4. Connect album download → integrity checks → offline cold navigation/playback.
   **Complete in automated Chromium mobile and desktop tests.**
5. Add unit/browser tests, guarded preview CI, decisions and deployment runbook.
   **Complete; remote preview remains unprovisioned.**

## Files and decisions

All application files are new under `deepcuts/`; the only addition elsewhere is
`.github/workflows/deepcuts.yml`. No pre-existing site file is modified. Source
and layout are mapped in [README](../README.md). Dependency versions are pinned
and locked independently of the Python site.

Core decisions: React/Vite static shell with Hono Worker; one owner with a random
access key and hashed cookie sessions; private R2 original objects and D1 metadata;
staging visibility for cross-service import consistency; sequential bounded
uploads; no transcoding; IndexedDB verified Blobs for offline playback; public-only
service-worker precache; separate environment identities and manually gated
preview releases. See [ARCHITECTURE](ARCHITECTURE.md) for evidence and tradeoffs.

## Validation

Final local verification:

| Check                                                      | Result                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| `npm run typecheck`                                        | Pass                                                      |
| `npm test`                                                 | 21 unit/API tests + 6 deployment/isolation tests pass     |
| `npm run test:e2e`                                         | 6 tests pass: Pixel 7 viewport and desktop Chromium       |
| `npm run build`                                            | PWA bundle, public shell precache and PNG icons generated |
| `npm run bundle:check`                                     | Worker dry-run succeeds; nothing uploaded                 |
| `npm run format:check`                                     | Pass                                                      |
| Existing personal-site `uv run pytest`                     | 105 pass                                                  |
| Existing personal-site `node --test tests/worker.test.mjs` | 13 pass                                                   |
| Existing personal-site `uv run python -m sitegen build`    | Pass, including structural checks                         |
| Tracked personal-site files / whitespace diff              | Unchanged / clean                                         |

Browser coverage includes real local D1/R2 import and playback, exact original
bytes for MP3/AAC/FLAC, ranges, seeking, queues, embedded art, verified download,
offline reload without cookies, local audio playback with zero API requests,
corruption detection, device removal, duplicate queued tracks, song-name search,
responsive overflow checks, dialog focus, and offline sign-out/revocation on the
next online launch. Each run gets fresh emulated resources; no previous fixture
state or development library is reset. Browser screenshots and failure traces
are ignored and generated from synthetic fixtures only.

The browser tests exposed and fixed a real offline navigation failure caused by
cached canonical redirects. Later checks also fixed duplicate queue positioning
and isolated stale fixture data between test runs. Tests exercise actual audio
time progression, not just a play-button state. No physical device checks, hosted
CI run, or remote deployment tests have been represented as completed.

## Preview and deployment

- Local preview: `cd deepcuts && npm ci && npm run dev`, then open
  `http://127.0.0.1:8788`. Key setup is documented in README.
- Remote preview: **not provisioned, not deployed**. The owner authorized a direct
  production release instead; dedicated production resources are now provisioned.
- CI: new path-scoped validation workflow, plus an optional protected manual
  preview release job. No production release automation is enabled.
- Required resources/secrets and the explicit approval boundary are in
  [DEPLOYMENT](DEPLOYMENT.md).

## Provisional or deferred

- Artist pages, song lists and richer search results.
- More than one album per import, background/resumable imports, duplicate
  detection, metadata editing, import-management UI and storage cleanup.
- Larger than 64 MiB tracks, resumable/multipart uploads, more than 100
  tracks/album, and unsupported/DRM files.
- Download resumption, progress in bytes, cross-tab coordination, encryption or
  an offline lock, cross-device queue/state conflict resolution.
- Storage persistence/eviction, codec support and long background audio sessions
  depend on the browser/device. No native app or transcoding fallback.
- Production deployment and remote release smoke tests now pass. Hosted CI has
  not been triggered; local validation and an explicitly authorized direct
  deployment were used to preserve the personal site's deployment pipeline.
- Production backup/restore, migration recovery policy and physical acceptance.

## Next recommended milestone

Begin importing small personally owned albums in production and refining the
experience. Add resumable/multipart large-file import and establish independent
verified backups. Physical acceptance for installed
offline launch, locked-screen playback, Bluetooth controls and installation is
deferred at the owner's request; it is not a prerequisite to beginning imports.
