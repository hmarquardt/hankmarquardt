# First milestone handoff

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

- Artist pages, song lists, richer search results, playlist CRUD and playlist
  offline downloads. Playlist tables exist only as a schema foundation.
- More than one album per import, background/resumable imports, duplicate
  detection, metadata editing, import-management UI and storage cleanup.
- Larger than 32 MiB tracks, more than 100 tracks/album, and unsupported/DRM files.
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
experience. Add resumable large-file import and playlist management/downloads,
and establish independent verified backups. Physical acceptance for installed
offline launch, locked-screen playback, Bluetooth controls and installation is
deferred at the owner's request; it is not a prerequisite to beginning imports.
