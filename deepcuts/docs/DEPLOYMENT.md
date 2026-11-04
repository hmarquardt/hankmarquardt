# Independent deployment

The owner explicitly authorized the first direct production deployment on
2026-11-02; a separate hosted preview is not required. Production releases use
only the dedicated `deepcuts` Worker, `deepcuts` D1 database and
`deepcuts-originals` private R2 bucket. The personal-site deployment is separate.

| Environment | Worker             | D1 binding `DB`    | R2 binding `MUSIC`           | Public routing               |
| ----------- | ------------------ | ------------------ | ---------------------------- | ---------------------------- |
| Local       | `deepcuts-local`   | local emulation    | local emulation              | `http://127.0.0.1:8788`      |
| Preview     | `deepcuts-preview` | `deepcuts-preview` | `deepcuts-preview-originals` | its own workers.dev origin   |
| Production  | `deepcuts`         | `deepcuts`         | `deepcuts-originals`         | `deepcuts.hankmarquardt.com` |

The preview ID is intentionally unresolved. The production config pins the reviewed
Cloudflare account, production D1 UUID and the exact production subdomain/zone.
The root `wrangler.json`, personal-site Worker `hankmarquardt`, its domains,
and Cloudflare CI secret are not reused. The personal-site workflow has a Deep Cuts path exclusion to prevent unrelated deployments. No wildcard routes,
root-domain routes, service bindings, cron jobs or public R2 access are configured.
The default `deepcuts/wrangler.json` is local-only, so Wrangler cannot walk up to
the personal-site config. Every automated command also names its config explicitly.

## Automated production releases

Deep Cuts uses the **same GitHub Actions Cloudflare credential** as the personal
site: repository secret `CLOUDFLARE_API_TOKEN`, repository variable
`CLOUDFLARE_DEPLOY_ENABLED=true`. No separate token, environment, or release
toggle is needed. The existing token must have sufficient permissions for the
dedicated Deep Cuts Worker, D1 migrations and R2 binding; if it does not, the
release fails without bypassing access controls.

On a push to `main` that changes `deepcuts/**` or the Deep Cuts workflow,
the dedicated workflow validates TypeScript, tests, the Worker build, and
Playwright before the production job. With the existing deployment gate enabled,
it checks approved migration hashes, runs an explicit production-config dry run,
applies only approved pending migrations to the pinned Deep Cuts D1, deploys
only the `deepcuts` Worker, and verifies the exact SHA at `/api/version`,
unauthenticated API denial, headers and public PWA assets.

The existing `OWNER_KEY` Worker secret is preserved. It is not placed in
GitHub. Deployments do not import or delete music. A failed deployment does not
automatically roll back the Worker or D1 database.

The personal-site push workflow skips commits containing only `deepcuts/**`
and `.github/workflows/deepcuts.yml`. Neither deployment job targets the
other application's Worker. Shared account credentials are deliberately used
for simplicity; resource identities and deploy commands remain separate.

## Local preview

`npm run dev` is the functioning preview, using the actual Worker and local R2/D1.
No remote or billable storage is used. Test data lives in `.wrangler/e2e`, separate
from normal development `.wrangler/state`. No remote Wrangler dev mode is used.
Do not run local browser recording/tracing tools against a private real library
and upload those artifacts. CI fixtures contain only generated tones.

## Required preview setup, after authorization

1. Create a **dedicated** D1 database named `deepcuts-preview` and a **private** R2
   bucket named `deepcuts-preview-originals` in the intended Cloudflare account.
   Their creation may incur charges and is not part of local setup. Keep R2 public
   access/r2.dev disabled. No R2 API keys or CORS policy are needed for the browser.
2. Determine the exact Worker origin:
   `https://deepcuts-preview.<account-subdomain>.workers.dev`. Make sure this
   account supports the workers.dev subdomain. No production DNS change is needed.
3. Configure a GitHub environment `deepcuts-preview`, with required reviewers and
   deployment branches restricted to `main`. Add these **environment/repository
   variables**:
   - `DEEPCUTS_ACCOUNT_ID`: reviewed Cloudflare account ID.
   - `DEEPCUTS_PREVIEW_D1_ID`: UUID of that existing preview database.
   - `DEEPCUTS_PREVIEW_ORIGIN`: exact HTTPS origin, no trailing slash.
   - `DEEPCUTS_PREVIEW_DEPLOY_ENABLED`: a **repository variable**; leave unset/false
     until release is approved. The job condition evaluates before environment
     variables are available, so this gate must not live only in the environment.
4. Add separate **secrets**:
   - `DEEPCUTS_CLOUDFLARE_API_TOKEN`: account-owned deployment token scoped to the
     intended account, for Workers Scripts edit, D1 edit and R2 storage read/edit
     as required by binding/deployment verification. No DNS or Workers Routes edit
     is needed for this preview. Cloudflare token permissions may be account wide;
     do not assume a Worker name provides an IAM boundary. Use a separate account
     if enforced account isolation is needed.
   - `DEEPCUTS_PREVIEW_OWNER_KEY`: **new**, random 32-byte value rendered as 64
     lowercase hex characters, generated and retained in a password manager. No
     local key or production key reuse. This becomes the Worker secret `OWNER_KEY`.
5. Review the concrete config generated by `node scripts/prepare-preview.mjs`
   with those variables. The script performs no network calls or writes to cloud
   resources and refuses unsafe names, database UUIDs, and preview origins.
6. Approve the preview release, set `DEEPCUTS_PREVIEW_DEPLOY_ENABLED=true`, and
   manually dispatch **Deep Cuts checks and optional preview** on `main` with
   `deploy_preview=true`. The dispatch is the explicit release action.

The workflow first runs TypeScript, unit/API tests, PWA/Worker builds, and Playwright
against local emulation. It validates existing resource identities and credentials,
checks the exact additive migration content hash, applies only that foundation to
preview D1, then deploys only `deepcuts-preview`. `--no-x-provision` and
`--no-x-auto-create` disable automatic provisioning. `OWNER_KEY` is supplied from
a mode-0600 temporary JSON secret file, never a CLI literal or asset. A read-only
smoke check verifies the exact commit at `/api/version`, an unauthenticated 401
for `/api/library`, and shell security headers. Future migrations are rejected
until a reviewed migration and recovery policy replaces the foundation-only gate.

There is no preview deploy on push or PR. Production deploys on Deep Cuts pushes to main when the existing shared Cloudflare deployment gate is enabled. `npm run deploy`
deliberately refuses. No workflows are dispatched or repository variables changed
as part of this implementation. The pre-existing personal-site workflow still
runs on all pushes and may release the unchanged site according to its own gate.

## Authorized direct production release

The first release is committed and pushed on `deepcuts/production-foundation` in
the existing repository. A push to `main` would run the existing personal-site
deployment, so this release branch preserves that Worker's live version and the
existing pipeline. No branch protections or deployment gates are changed. The
owner's direct-production authorization supersedes the foundation's suggested
preview-first sequence. Physical-device acceptance is deferred at the owner's
request. Subsequent production releases use the existing GitHub Actions Cloudflare deployment gate described above; `npm run deploy` remains a refusal guard.

Production uses D1 `0922ad5d-3193-4e49-9ff5-9926d782792d`, binding `DB`, and R2
`deepcuts-originals`, binding `MUSIC`, in account
`b1aa310aa0a1638d72b8b086a21e557c`. Only the Worker custom domain
`deepcuts.hankmarquardt.com` is configured. Never attach a public domain or enable
`r2.dev` on the bucket. Neither R2 API keys nor browser CORS rules are needed.

The production `OWNER_KEY` is a separately generated 256-bit random value, uploaded
as a Worker secret alongside the release using `--secrets-file`. The config declares
it required. The mode-0600 local source files are `.production/owner-key.txt` and
`.production/secrets.json`, inside an ignored mode-0700 directory. The owner should
retain the access key in a password manager. It is never printed, included in
assets, committed, or recorded in browser screenshots/traces. Do not reuse the
local development key. Rotating this secret invalidates all existing sessions.

The reviewed migration set is additive. `0001_foundation.sql` creates the
foundation tables; `0002_playlists.sql` only adds a unique
`(playlist_id, track_id)` index, a track lookup index and a created-at index to
the playlist tables that already exist. Verify both hashes with
`node scripts/check-preview-migration.mjs` (the content check is shared with
preview), then apply them to **this dedicated database only**:

```sh
npx wrangler d1 migrations apply DB --remote --config wrangler.production.json \
  --no-x-provision --no-x-auto-create
```

Wrangler applies only pending migrations, so existing albums, tracks, playlists,
sessions and listening state are preserved; the playlist index creation is additive
and cannot touch rows. Because `0002` is index-only, an older Worker can still read
and write the schema after a rollback. Any future migration requires a new review
and a recovery plan. D1 Time Travel is platform recovery; scheduled exports,
independent R2 backup and a verified restore remain follow-up work. Keep another
copy of all originals; this release is a listening interface, not yet the sole
archival home for the collection.

For an explicitly authorized release, from a clean committed release branch:

```sh
cd deepcuts
npm run typecheck
npm test
npm run test:e2e
npm run build
node scripts/check-preview-migration.mjs
npx wrangler deploy --dry-run --config wrangler.production.json --no-x-provision --no-x-auto-create --secrets-file .production/secrets.json
npx wrangler d1 migrations apply DB --remote --config wrangler.production.json --no-x-provision --no-x-auto-create
npx wrangler deploy --config wrangler.production.json --no-x-provision --no-x-auto-create --secrets-file .production/secrets.json --var "DEPLOY_REVISION:$(git rev-parse HEAD)" --message "Deep Cuts production $(git rev-parse HEAD)"
DEEPCUTS_REVISION="$(git rev-parse HEAD)" npm run smoke:production
```

The production smoke runs real HTTPS API checks and mobile/desktop Chromium
sign-in and sign-out, validates revocation and API/media access control, checks
the exact commit, loads JS/CSS and install assets, and verifies the service-worker
cache contains no private API responses. It writes no music/import data and
records no production credentials or library contents in logs or browser artifacts.
Compare the personal site's current deployment, domains/routes and live version
with the captured pre-release baseline. The local audit uses authenticated
read-only API calls; authoritative DNS listing can require additional DNS Read
permission beyond the standard Wrangler OAuth scopes.

## Recovery

- Owner credential lost or suspected compromised: rotate the environment's
  `OWNER_KEY` secret. All old sessions fail immediately. Retain the new value in
  the password manager. No recovery email or unauthenticated reset API exists.
- Bad Worker release: roll back the **Deep Cuts environment's** Worker version
  after operator authorization; never target `hankmarquardt`. Additive schema is
  compatible with a Worker rollback, but a Worker rollback does not undo D1 data.
- Partial import: it stays hidden. The authenticated imports API exposes open
  manifests and supports abandonment. Choose the album again to start a new
  import; no cloud originals are deleted. Review abandoned storage before any
  separately authorized cleanup.
- Damaged download: remove its local copy, reconnect, sign in, and download again.
  The R2 original is unaffected. Device clearing is not a cloud library deletion.
