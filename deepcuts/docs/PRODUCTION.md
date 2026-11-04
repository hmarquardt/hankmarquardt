# Production releases

**Live:** https://deepcuts.hankmarquardt.com

The owner explicitly authorized direct production deployment, dedicated resource
creation and production authentication. A separate hosted preview and physical
device acceptance were not required for these releases.

## Current release — uploads and playlists

| Item                    | Value                                                                 |
| ----------------------- | --------------------------------------------------------------------- |
| Source repository       | `hmarquardt/hankmarquardt`                                            |
| Release branch          | `deepcuts/uploads-and-playlists`                                      |
| Deployed source commit  | `0b522c81ca92040f2b8a7db4eeac71b25c791d4c`                            |
| Cloudflare Worker       | `deepcuts`                                                            |
| Deployed Worker version | `8c9e51fa-6d55-46e5-9157-ae9b2a914052`                                |
| D1                      | `deepcuts`, UUID `0922ad5d-3193-4e49-9ff5-9926d782792d`, binding `DB` |
| R2                      | `deepcuts-originals`, binding `MUSIC`, Standard storage in ENAM       |
| Authentication          | Required Worker secret `OWNER_KEY`, unchanged production value        |
| Live revision endpoint  | `/api/version`                                                        |

### What changed

- The per-track upload ceiling moves from 32 MiB to **64 MiB**. Each original now
  streams from the request into R2 through a verifying transform that counts
  bytes, checks the MP3/FLAC/MP4 signature on the first bytes and hashes
  incrementally with `node:crypto`, so Worker memory stays flat. A
  `FixedLengthStream` supplies the exact object length and R2 receives the write
  only after verification. Digest, length or signature mismatches error the
  stream before commit; repeated uploads never overwrite an object; retries verify
  the resent body and compare the stored size and digest metadata.
- Playlists are complete: create, rename, delete, add from any album, add a track
  to more than one playlist, remove, reorder, play in order, shuffle and append
  to the existing queue. Playlists reference existing track ids; no audio is
  copied and removing a track never deletes music.
- "Download playlist" stores only missing originals in the existing IndexedDB
  file store, reuses audio already saved by downloaded albums or other playlists,
  keeps files that another downloaded collection still needs, and remains playable
  offline after a cold PWA reload. Storage reporting counts unique bytes.
- Additive migration `0002_playlists.sql` adds the unique
  `(playlist_id, track_id)` index, a track lookup index and a created-at index.

### Verified

- Reviewed additive migration `0002_playlists.sql` applied to the existing
  production D1 (5 commands; only that migration was pending). No table was
  rewritten and no row was deleted.
- Production data preserved exactly: **23 albums, 260 tracks, 2,566,301,578
  bytes** and the same single pre-existing staging import before and after the
  release. The playlist endpoint reports 0 playlists because none existed before.
- Production Worker deployed from the reviewed commit with explicit config, the
  exact account/zone/database, the existing required secret file and automatic
  resource provisioning disabled. `/api/version` returns the full deployed SHA.
- Real HTTPS smoke passed: invalid login rejected, cross-origin mutation
  rejected, login/session/logout and revocation, authenticated library, imports,
  playlists and state APIs, missing playlist and media 404s, unauthenticated
  library/media/playlist rejection, CSP and security headers, hashed assets,
  manifest, installation icons, public-only service-worker cache, and mobile
  Pixel 7 plus desktop Chromium sign-in, render, layout and sign-out checks.
- R2 `r2.dev` remains disabled with no enabled public custom domain.
- Personal-site isolation re-verified: Worker `hankmarquardt` stays on deployment
  `a2081941-a2e9-49da-9330-de5b71e27608` / version
  `a57c3d37-4eb1-40d2-95f0-9fae11bbd3b7`, serving revision `575be1f`. Its
  deployment metadata, domains, zone routes and live `version.json` are identical
  to the pre-release snapshot. Apex and www public DNS answers are unchanged. The
  root Wrangler config, personal-site Worker source and personal-site workflow
  were not modified; the only workflow edit is a Deep Cuts step label.
- The first deploy of this release was `cc54027`; a follow-up on the same branch
  (`0b522c8`) reclaims files a previously downloaded playlist no longer
  references. It re-passed the dry run, both browser projects, the production
  smoke and the same before/after data check. The table above records the final
  revision and Worker version.
- Local validation: **53** unit/API tests, **6** isolation/deployment tests,
  **12** mobile and desktop browser tests, TypeScript, Prettier, PWA build and a
  production dry-run bundle. The personal site's `uv run pytest` (105), worker
  tests (13) and `sitegen build` also pass unchanged.

### Remaining limitations

- 64 MiB is the safe single-request ceiling. Larger or high-resolution FLAC needs
  multipart/resumable uploads: R2 multipart parts, per-part digests, resume state
  in D1, an idempotency key, cleanup of abandoned uploads and resume UI. The
  current path restarts an interrupted upload from the beginning, and the browser
  still hashes each whole file in memory before uploading.
- Uploads require an exact `Content-Length`; a body without one is refused with
  HTTP 411.
- Downloads are unencrypted in the trusted browser profile, remain subject to
  browser storage quotas and eviction, and download operations assume one active
  app tab. Cross-tab download coordination and cross-device listening-state
  reconciliation are not implemented.
- Scheduled independent backups and a tested restore are not configured. Retain
  another copy of originals; the app is not yet a sole archival home.
- Physical installation, locked-screen longevity, Bluetooth controls and device
  codec/storage acceptance remain untested and deferred. Mobile layout and
  offline behavior were verified with viewport emulation only.
- A protected production CI release workflow remains future work. Future direct
  production releases require explicit authorization and the documented checks.

## First release — foundation (2026-11-02)

| Item                    | Value                                      |
| ----------------------- | ------------------------------------------ |
| Release branch          | `deepcuts/production-foundation`           |
| Deployed source commit  | `59fea76fd62a0c180c9a3e1fd83ef92fe32e68fa` |
| Deployed Worker version | `d55c89ae-d0d5-4020-9f5f-3c23f28c9675`     |
| Migration               | `0001_foundation.sql`, all 11 statements   |
| Local validation        | 21 unit/API, 6 isolation, 6 browser tests  |

The foundation release created the dedicated Worker, D1 database, private R2
bucket and owner authentication. `main` was not pushed, so the personal site's
push-to-main deployment was not triggered.

## Sign in

The owner access key is stored locally in `deepcuts/.production/owner-key.txt`.
Copy it into the production sign-in form and retain it in a password manager. It
is never included in this document, chat output, Git, public assets or browser
artifacts. The directory has mode `0700`; key and upload-source files have mode
`0600`. `.production/` is ignored. `secrets.json` in that directory is the local
source used for the required Worker secret; do not share or commit either file.

The production key differs from the local development key. Login issues a
host-only Secure/HttpOnly/SameSite=Strict cookie; the access key is not retained
by the client. Rotate the `OWNER_KEY` Worker secret to revoke all sessions.

## Personal-site isolation

The existing `hankmarquardt` Worker remains on its own version and revision.
Authenticated before/after snapshots confirmed its deployment metadata,
custom-domain bindings, zone Worker routes and live revision are unchanged. Only
the `deepcuts.hankmarquardt.com` custom domain belongs to this application. The
root Wrangler config, site Worker source and personal-site workflow are
byte-identical to the original revision. No push to `main`, workflow dispatch,
pipeline gate change, existing-domain route change, or existing-name DNS write was
performed by a Deep Cuts release.

The standard Wrangler OAuth login lacks authoritative DNS Record Read permission:
those API reads return 403. Consequently a complete authoritative DNS-record diff
is not available. Existing domain assignments, routing and public DNS resolution
were checked independently.

Use the [deployment runbook](DEPLOYMENT.md) for the exact configuration, release
commands and recovery procedure.
