# Foundation decisions

## Repository inspection and isolation

Inspected the clean `main` working tree, remotes, root README, site generator,
tests, static files, `src/worker.mjs`, `wrangler.json`, and
`.github/workflows/site.yml` before creating this application. The personal site
is Python/Jinja static output, served by Worker `hankmarquardt`, with no database
or npm package. Its workflow validates every push/PR and can deploy on `main` when
the existing deployment variable is enabled.

Also inspected the sibling CFLab repository's guide, auth routes, password and
session design, local bindings, migrations, and CI runbook. Retained the useful
patterns: strict TypeScript, a small Hono API, explicit bindings, hashed opaque
sessions, D1 transactions, additive migrations, release revision verification,
and explicit deployment gates. Its multi-user password recovery, email, app
memberships, cross-origin bearer tokens, analytics, and backup platform are not
needed for this foundation and were not copied. There are no CFLab runtime imports,
service bindings, credentials, shared databases, bucket references, or calls.

All application source, configuration, dependencies and local state live inside
`deepcuts/`. The only new file outside it is `.github/workflows/deepcuts.yml`.
The personal site's files and workflow are unchanged. Because its existing
workflow has no path filter, a future push to `main` can still run that site's
normal validation/deployment; no push or release is performed by this work.

## Runtime and public shell

React + Vite build static assets; Hono runs the API. The Worker executes first on
every request, applies headers, authenticates all private routes, and delegates
the public shell to its own Static Assets binding. Shell assets contain no music,
library metadata, secrets, analytics, remote fonts or third-party requests. R2 has
no public URL; only authenticated Worker endpoints can read originals and artwork.

This follows the documented [Static Assets binding](https://developers.cloudflare.com/workers/static-assets/binding/)
and [R2 Worker API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
No S3 credentials are required at runtime. The build generates correctly sized
PNG installation icons from the application-owned vector mark.

## Single-owner authentication

The operator generates a **256-bit random access key** (64 lowercase hex characters)
in a password manager and installs it as the Worker secret `OWNER_KEY`. This is a
high-entropy credential, not a human-chosen password. There is no sign-up, bootstrap
endpoint, email, password reset, or remote dependency. If a human password is
introduced later it needs a suitable password KDF or, preferably, passkeys.

Login compares fixed-size SHA-256 digests using the runtime's timing-safe compare.
The client receives a random 256-bit session in a host-only `__Host-` cookie with
`Secure`, `HttpOnly`, `SameSite=Strict`, `/` path and a fixed 30-day expiry. Local
loopback development uses a separate non-Secure cookie name. D1 stores only session
hashes, expiry, and the configured owner-key hash. Rotating `OWNER_KEY` invalidates
every old session immediately. Logout revokes the current session. Expired rows
are pruned on successful login. No credential enters localStorage, IndexedDB,
URLs, API JSON responses, or app logs.

Every API mutation, including login and raw file uploads, requires the configured
same origin; cross-site Fetch Metadata is rejected. No CORS access is granted.
Login is limited to ten attempts/minute per Cloudflare location for the single
owner. The platform [rate limiter is approximate](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/),
so the entropy of the access key remains essential. Production secrets never use
the generated local key. Secret rotation is the initial recovery mechanism.

## Import consistency and limits

The browser parses tags with the maintained `music-metadata` package and hashes
one original at a time. The album and track manifest is validated server-side;
track bodies are length checked, signature checked, hashed again while streaming
and only then committed to R2. Metadata reflects what the owner imports and can
be overridden at import. The server does not reparse all tags or prove that a
bitstream decodes; browser tests use real generated files to cover decoding.

An import starts as `staging`. Each track has a UUID, expected size and SHA-256,
plus a server-assigned R2 object key. Conditional writes prevent replacement of an
original; retries check the existing object's size and digest metadata. Completion
uses a conditional SQL update that requires every track to be uploaded. Library
and media queries join only completed imports, so partial albums never leak.
R2 and D1 cannot commit together; a successful R2 write followed by a failed D1
write leaves a hidden object, and retry repairs the uploaded marker. Abandoning an
import retains its original objects for review. No destructive cloud cleanup or
committed-library deletion endpoint exists.

Tracks stream from the request straight into R2 through a verifying transform, so
memory stays flat instead of growing with the file. The transform counts bytes,
checks the MP3/FLAC/MP4 signature from the first bytes, hashes incrementally with
`node:crypto` and errors the stream before R2 commits when the digest, length or
container does not match. A `FixedLengthStream` supplies R2 with the exact object
length. The server requires an exact `Content-Length` (HTTP 411 otherwise) because
a fixed-length R2 write depends on it. A repeated upload never rewrites an object;
it re-verifies the retried body and compares the stored size and digest metadata.

Current limits: one album, at most 100 tracks, **64 MiB per track**, artwork up to
5 MiB in JPEG/PNG. Originals are never converted, renamed in content, or
transcoded. 64 MiB is the largest single `put()` this Worker can stream safely
inside the 128 MB memory budget while also hashing; the Cloudflare Free/Pro plan
caps any request body at 100 MB, so 64 MiB leaves headroom and satisfies the
common purchased-album case. The client still computes each digest with Web Crypto,
which needs one whole `ArrayBuffer` per file; browsers hold that without issue, but
physical mobile memory was not measured. Large/high-resolution FLAC and slow
connections need a resumable design: multipart R2 uploads (5 MiB–5 GiB parts,
10,000 parts), per-part `uploadId` state in D1, per-part SHA-256 verification, a
client-generated idempotency key, resume UI and a lifecycle rule for abandoned
multipart uploads. That work is deferred; the current single-request path restarts
from the beginning when interrupted. Imported filenames are metadata only and
cannot choose storage keys or paths. SVG artwork is rejected. Reimporting creates
another album; deduplication and resume UI are future work.

## Playlists

Playlists reference existing track ids; no audio is copied, and deleting or
editing a playlist never touches an album, track or R2 object. The foundation
migration already created `playlists` and `playlist_tracks`; the additive
`0002_playlists.sql` adds a unique `(playlist_id, track_id)` index (one instance of
a track per playlist), a track lookup index and a created-at index. Ordering lives
in `playlist_tracks.position`, addressed as 0..n-1. Reordering rewrites the whole
order inside one D1 batch, first offsetting every position so the composite primary
key cannot collide. Removal compacts the remaining positions the same way.

The playlist API is authenticated by the same owner session and same-origin checks
as every other mutation. It exposes list, create, rename, delete, add, remove and a
full-order reorder. Adds require a UUID that belongs to a completed import; unknown
or still-staging tracks are rejected with 404 so a playlist cannot reference hidden
audio. Reorder requests must be a permutation of the current membership, which
makes a stale editor fail instead of silently dropping or duplicating tracks.

The interface adds a playlists view, a mobile-first editor with per-track move and
remove controls, an "add to playlist" action on every album track, and a picker
that searches the whole library. Play and shuffle reuse the single global player
and existing queue; "add to queue" appends the playlist's tracks in order.

## Downloaded playlists

A playlist download reuses the existing IndexedDB model: one `files` store keyed by
track id, one `albums` store for album downloads, one `playlists` store added by a
versioned upgrade, and one settings store. Downloading a playlist fetches only
tracks whose size and digest are not already stored, so audio shared with a
downloaded album (or another playlist) is written once. A completion record is
written last, so an interrupted playlist never appears available. Removing a
playlist or album only deletes files that no remaining downloaded collection
references, which keeps another collection's offline copy intact. The playlist
record carries the full track metadata needed to play and render while offline,
including after a cold PWA reload. Device storage reporting counts unique track
bytes across albums and playlists plus album artwork, instead of double-counting
shared tracks.

## Online and offline audio

The Worker streams R2 bodies directly. It supports full GET, HEAD, one validated
byte range, suffixes and open-ended ranges; invalid or multiple ranges return 416.
If-Range compares the immutable SHA-256 ETag; a mismatch returns the full object.
All private responses, including audio and errors, use `Cache-Control: no-store`.

A single HTML audio element persists while the SPA navigates. Online playback uses
cookie-authenticated media endpoints. Downloads store the exact original Blob,
its expected digest, album metadata and cover art in IndexedDB. A final album
record marks the complete download. Download failures remove partial track data;
the next launch removes orphan files from interrupted downloads. Download and
playback both check size and SHA-256. Offline playback uses verified local Blob
URLs, so seeking is handled by the browser without an API or service-worker audio
proxy. Queue and position are saved locally; the server also accepts a listening
snapshot. Cross-device reconciliation is deliberately not implemented.

The versioned service worker precaches only generated public shell assets. The
shell cache normalizes the canonical `/index.html` redirect: cached redirected
responses cannot satisfy an offline manual-redirect navigation in Chromium. Cache
activation waits for older app tabs to close; no forced reload interrupts audio.
Browser tests remove cookies and connectivity before reloading and assert **zero
API requests**, then exercise actual local audio playback.

## Privacy and device boundaries

Choosing Download explicitly authorizes retaining that album on this browser/device.
The collection remains playable after a server session expires, without contacting
the server. Downloads are not encrypted or protected by a separate offline PIN.
Use a trusted, device-locked profile. Server logout/revocation cannot remotely
erase an offline device; Sign out & clear device removes its albums, files and
listening state. An offline sign-out records a credential-free revocation flag
and suppresses session restoration until a subsequent online launch revokes it.
The public shell cache may remain on disk and contains no private data.

Storage persistence is requested but the browser can deny it, and quotas/eviction
remain browser controlled. Hashing buffers one bounded track at a time. Downloads
are sequential, and operations assume one active app tab; concurrent import or
download coordination across tabs is not implemented. Interrupted downloads start
over. DRM-protected purchases are not supported. Codec support depends on the
browser/OS; no decode/transcode fallback is supplied. Bluetooth uses the device's
normal audio routing, not Web Bluetooth.

Physical acceptance remains separate: installed PWA offline cold launch, locked
screen audio longevity, OS media/Bluetooth controls, iOS/Android codec behavior,
installation, storage pressure and multi-hour playback. Desktop/mobile emulation
does not establish these properties. Backups and a verified restore are required
before the app becomes the sole home for a personal library.
