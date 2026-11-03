# First production release

**Live:** https://deepcuts.hankmarquardt.com

The owner explicitly authorized direct production deployment, dedicated resource
creation and production authentication. A separate hosted preview and physical
device acceptance were not required for this release.

| Item                    | Value                                                                 |
| ----------------------- | --------------------------------------------------------------------- |
| Source repository       | `hmarquardt/hankmarquardt`                                            |
| Release branch          | `deepcuts/production-foundation`                                      |
| Deployed source commit  | `59fea76fd62a0c180c9a3e1fd83ef92fe32e68fa`                            |
| Cloudflare Worker       | `deepcuts`                                                            |
| Deployed Worker version | `d55c89ae-d0d5-4020-9f5f-3c23f28c9675`                                |
| D1                      | `deepcuts`, UUID `0922ad5d-3193-4e49-9ff5-9926d782792d`, binding `DB` |
| R2                      | `deepcuts-originals`, binding `MUSIC`, Standard storage in ENAM       |
| Authentication          | Required Worker secret `OWNER_KEY`, unique production value           |
| Live revision endpoint  | `/api/version`                                                        |

The completed foundation is commit `c5fecf8`; the production configuration and
smoke checks are commit `59fea76`. A subsequent documentation-only commit records
this result and does not change the deployed runtime. Both implementation commits
are pushed on the dedicated release branch. `main` remains unchanged so the
personal site's push-to-main deployment is not triggered.

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

## Verified

- Reviewed additive migration `0001_foundation.sql` applied to the newly created,
  empty dedicated production database: all 11 statements succeeded.
- Production Worker deployed with explicit config, exact account/zone/database,
  required secret file and automatic resource provisioning disabled.
- R2 `r2.dev` access is disabled and no public custom domain is enabled. Only the
  authenticated Worker binding exposes audio and artwork.
- Live `/api/version` matches the full deployed source SHA above.
- Real HTTPS smoke: invalid login rejected, cross-origin mutation rejected,
  successful login, secure cookie flags, authenticated library/import/state APIs,
  unauthenticated library/media rejection, missing-media 404 for an authenticated
  session, logout and subsequent session revocation.
- Public shell, CSP and other security headers, hashed JS/CSS, manifest,
  installation PNGs and service-worker JavaScript all load successfully.
- Production Chromium: mobile Pixel 7 emulation and desktop sign-in, actual
  library render, layout bounds, public-only service-worker precache and sign-out.
  No production screenshot, trace, video, credential or library-content log was
  recorded. These tests wrote sessions only; no music, album or import was added.
- Local validation: 21 unit/API tests, 6 isolation/deployment tests, 6 mobile and
  desktop browser tests, TypeScript, formatting, PWA build and production dry-run.
- Release content and built assets scanned against actual production and local
  owner keys. No owner credential, private credential path or music file is tracked.

The first immediate post-deploy smoke failed during public-asset assertions after
authentication checks passed. Independent public-asset diagnostics and a full
HTTPS/browser rerun then passed. The first failure's cause was not established;
no security control or assertion was removed to pass the rerun.

## Personal-site isolation

The existing `hankmarquardt` Worker remains on version
`5d0f5661-307a-4af2-a1b7-4bae19dfa958`, serving revision
`f4e879d44d05821e281db0aa53d9b420c0aece34`. Authenticated before/after snapshots
confirmed its deployment metadata, custom-domain bindings, zone Worker routes and
live revision are unchanged. Apex and www public IPv4/IPv6 answers are unchanged.
Only the new `deepcuts.hankmarquardt.com` custom domain was attached. The root
Wrangler config, site Worker source and personal-site workflow are byte-identical
to the original revision. No push to `main`, workflow dispatch, pipeline gate
change, existing-domain route change, or existing-name DNS write was performed.

The standard Wrangler OAuth login lacks authoritative DNS Record Read permission:
those API reads returned 403. Consequently a complete authoritative DNS-record
diff was not available. This verification limit did not prevent the authorized
new-subdomain deployment; existing domain assignments, routing and public DNS
resolution were independently checked as described above.

## Remaining limitations

- Imports are one album at a time, at most 100 tracks and 32 MiB per original
  track. Larger high-resolution FLAC needs resumable/multipart uploads.
- Playlist CRUD/downloads, dedicated artist/song pages, richer search, import
  resumption/deduplication and metadata editing remain future work.
- Downloads are unencrypted in the trusted browser profile and remain subject
  to browser storage quotas/eviction. Cross-tab download coordination and
  cross-device listening-state reconciliation are not implemented.
- Scheduled independent backups and a tested restore are not configured. Retain
  another copy of originals; the app is not yet a sole archival home.
- Physical installation, locked-screen longevity, Bluetooth controls and device
  codec/storage acceptance remain untested and deferred. No native app packaging.
- A protected production CI release workflow remains future work. Future direct
  production releases require explicit authorization and the documented checks.

Use the [deployment runbook](DEPLOYMENT.md) for the exact configuration, release
commands and recovery procedure. The next work is real-album imports and usability
refinement, followed by larger-file imports, playlists and verified backups.
