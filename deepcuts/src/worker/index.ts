import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError, z } from "zod";
import type { AppEnv } from "./env";
import {
  assertOrigin,
  digest,
  login,
  sessionCookie,
  tokenFromRequest,
  validSession,
} from "./auth";
import {
  artworkMime,
  boundedBody,
  contentLength,
  fixedLengthStream,
  importSchema,
  jsonBody,
  playlistCreateSchema,
  playlistOrderSchema,
  playlistRenameSchema,
  playlistTrackSchema,
  stateSchema,
  verifyAudioStream,
} from "./validation";
import {
  MAX_ART_BYTES,
  MAX_AUDIO_BYTES,
  MAX_PLAYLISTS,
  MAX_PLAYLIST_TRACKS,
  type Album,
  type Playlist,
  type PlaylistSummary,
  type Track,
} from "../shared/model";
import { byteRange } from "../shared/range";

const app = new Hono<AppEnv>();
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header("X-Robots-Tag", "noindex, nofollow");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  c.header(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  if (new URL(c.req.url).protocol === "https:")
    c.header("Strict-Transport-Security", "max-age=31536000");
  if (
    c.req.path.startsWith("/api/") ||
    c.req.path === "/sw.js" ||
    c.res.headers.get("Content-Type")?.includes("text/html")
  )
    c.header("Cache-Control", "no-store");
});
app.onError((error, c) => {
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status);
  if (error instanceof ZodError)
    return c.json({ error: "Invalid request fields." }, 400);
  // Do not log requests, metadata, credentials, or database exception strings.
  console.error("Deep Cuts request failed.");
  return c.json({ error: "Deep Cuts could not complete this request." }, 500);
});
app.use("/api/*", async (c, next) => {
  if (!["GET", "HEAD"].includes(c.req.method)) assertOrigin(c.req.raw, c.env);
  if (
    !["/api/login", "/api/version"].includes(c.req.path) &&
    !(await validSession(c.req.raw, c.env))
  ) {
    throw new HTTPException(401, { message: "Sign in to your library." });
  }
  await next();
});
app.get("/api/version", (c) =>
  c.json({ app: "deepcuts", revision: c.env.DEPLOY_REVISION }),
);
app.post("/api/login", async (c) => {
  // Single owner, so one per-location login bucket also bounds aggregate guessing.
  if (!(await c.env.LOGIN_LIMIT.limit({ key: "deepcuts-owner" })).success) {
    c.header("Retry-After", "60");
    throw new HTTPException(429, {
      message: "Too many attempts. Try again in a minute.",
    });
  }
  const { key } = z
    .object({ key: z.string().min(1).max(256) })
    .strict()
    .parse(await jsonBody(c.req.raw, 1024));
  c.header("Set-Cookie", sessionCookie(c.env, await login(key, c.env)));
  return c.json({ ok: true });
});
app.get("/api/session", (c) => c.json({ authenticated: true }));
app.post("/api/logout", async (c) => {
  const token = tokenFromRequest(c.req.raw, c.env);
  if (token)
    await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await digest(token))
      .run();
  c.header("Set-Cookie", sessionCookie(c.env, "", 0));
  return c.json({ ok: true });
});
app.get("/api/library", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.artist, a.year, a.artwork_key IS NOT NULL AS has_artwork
    FROM albums a JOIN imports i ON a.import_id=i.id WHERE i.status='complete' ORDER BY a.created_at DESC, a.id`,
  ).all();
  const tracks = await c.env.DB.prepare(
    `SELECT t.id,t.album_id,t.title,t.artist,t.track_number,t.disc_number,t.duration,t.filename,t.mime,t.bytes,t.sha256
    FROM tracks t JOIN albums a ON t.album_id=a.id JOIN imports i ON a.import_id=i.id
    WHERE i.status='complete' ORDER BY t.disc_number,t.track_number,t.id`,
  ).all<Track>();
  const albums: Album[] = rows.results.map((row) => ({
    ...row,
    has_artwork: !!row.has_artwork,
    tracks: tracks.results.filter((t) => t.album_id === row.id),
  })) as Album[];
  return c.json({ albums });
});
app.get("/api/imports", async (c) => {
  const imports = await c.env.DB.prepare(
    `SELECT i.id,i.status,i.created_at,a.title,
    (SELECT count(*) FROM tracks t WHERE t.album_id=a.id AND t.uploaded=1) AS uploaded,
    (SELECT count(*) FROM tracks t WHERE t.album_id=a.id) AS total
    FROM imports i JOIN albums a ON a.import_id=i.id WHERE i.status='staging' ORDER BY i.created_at DESC`,
  ).all();
  return c.json({ imports: imports.results });
});
app.post("/api/imports", async (c) => {
  const data = importSchema.parse(await jsonBody(c.req.raw));
  const id = crypto.randomUUID();
  const albumId = crypto.randomUUID();
  const tracks = data.tracks.map((t) => ({ ...t, id: crypto.randomUUID() }));
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO imports(id) VALUES(?)").bind(id),
    c.env.DB.prepare(
      "INSERT INTO albums(id,import_id,title,artist,year) VALUES(?,?,?,?,?)",
    ).bind(albumId, id, data.title, data.artist, data.year),
    ...tracks.map((t) =>
      c.env.DB.prepare(
        `INSERT INTO tracks(id,album_id,title,artist,track_number,disc_number,duration,filename,mime,bytes,sha256,object_key)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        t.id,
        albumId,
        t.title,
        t.artist,
        t.track_number,
        t.disc_number,
        t.duration,
        t.filename,
        t.mime,
        t.bytes,
        t.sha256,
        `imports/${id}/${t.id}`,
      ),
    ),
  ]);
  return c.json(
    {
      id,
      album_id: albumId,
      tracks: tracks.map((t) => ({ id: t.id, filename: t.filename })),
    },
    201,
  );
});
app.put("/api/imports/:id/tracks/:track", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT t.* FROM tracks t JOIN albums a ON t.album_id=a.id JOIN imports i ON a.import_id=i.id
    WHERE i.id=? AND t.id=? AND i.status='staging'`,
  )
    .bind(c.req.param("id"), c.req.param("track"))
    .first<Track & { object_key: string }>();
  if (!row)
    throw new HTTPException(404, { message: "Open import track not found." });
  // R2 needs an exact object length, so a declared Content-Length is required.
  // The browser always sends one for a File body.
  const declared = contentLength(c.req.header("Content-Length") ?? null);
  if (declared === null)
    throw new HTTPException(411, {
      message: "Send the whole original file with a Content-Length header.",
    });
  if (declared > MAX_AUDIO_BYTES)
    throw new HTTPException(413, {
      message: `Tracks are limited to ${Math.floor(MAX_AUDIO_BYTES / 1024 ** 2)} MiB each.`,
    });
  if (declared !== row.bytes)
    throw new HTTPException(422, {
      message:
        "File size does not match this import. Choose the original file again.",
    });
  if (!c.req.raw.body)
    throw new HTTPException(400, { message: "A request body is required." });
  // The body streams straight into R2 through a verifying transform. It is never
  // buffered whole, so a 64 MiB original cannot exhaust Worker memory. The
  // transform hashes incrementally and errors the stream before R2 commits when
  // the digest, length or audio container does not match.
  const verified = verifyAudioStream(c.req.raw.body, {
    bytes: row.bytes,
    sha256: row.sha256,
    mime: row.mime,
  });
  const markUploaded = () =>
    c.env.DB.prepare("UPDATE tracks SET uploaded=1 WHERE id=?")
      .bind(row.id)
      .run();
  // A retry after a successful write never touches R2 again, but the retried body
  // is still verified so a different file cannot be reported as imported.
  const existing = await c.env.MUSIC.head(row.object_key);
  if (existing) {
    if (
      existing.size !== row.bytes ||
      existing.customMetadata?.sha256 !== row.sha256
    )
      throw new HTTPException(409, {
        message:
          "The stored original does not match this import. It has not been overwritten.",
      });
    await verified.body.pipeTo(new WritableStream()).catch(() => undefined);
    const rejected = verified.failure();
    if (rejected)
      throw new HTTPException(rejected.status, { message: rejected.message });
    await markUploaded();
    return c.json({ ok: true });
  }
  const fixed = fixedLengthStream(declared);
  const pump = verified.body.pipeTo(fixed.writable).catch(() => undefined);
  let written: R2Object | null = null;
  try {
    written = await c.env.MUSIC.put(row.object_key, fixed.readable, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: row.mime },
      customMetadata: { sha256: row.sha256 },
    });
  } catch {
    await pump;
    const rejected = verified.failure();
    if (rejected)
      throw new HTTPException(rejected.status, { message: rejected.message });
    if (verified.received() < row.bytes)
      throw new HTTPException(422, {
        message:
          "The upload was interrupted before the whole file arrived. Choose the original file again.",
      });
    throw new HTTPException(502, {
      message: "The original could not be stored. Try again.",
    });
  }
  if (written) {
    await pump;
    const rejected = verified.failure();
    if (rejected)
      throw new HTTPException(rejected.status, { message: rejected.message });
    if (written.size !== row.bytes) {
      await c.env.MUSIC.delete(row.object_key);
      throw new HTTPException(422, {
        message:
          "The stored original was incomplete. Choose the original file again.",
      });
    }
  } else {
    // Lost a concurrent write race. Never replace an existing original.
    const stored = await c.env.MUSIC.head(row.object_key);
    if (
      !stored ||
      stored.size !== row.bytes ||
      stored.customMetadata?.sha256 !== row.sha256
    ) {
      throw new HTTPException(409, {
        message:
          "The stored original does not match this import. It has not been overwritten.",
      });
    }
  }
  await markUploaded();
  return c.json({ ok: true });
});
app.put("/api/imports/:id/artwork", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT a.id FROM albums a JOIN imports i ON a.import_id=i.id WHERE i.id=? AND i.status='staging'`,
  )
    .bind(c.req.param("id"))
    .first<{ id: string }>();
  if (!row) throw new HTTPException(404, { message: "Open import not found." });
  const bytes = await boundedBody(c.req.raw, MAX_ART_BYTES);
  const mime = artworkMime(bytes);
  if (!mime)
    throw new HTTPException(415, { message: "Artwork must be a JPEG or PNG." });
  const key = `imports/${c.req.param("id")}/cover`;
  await c.env.MUSIC.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: mime },
  });
  await c.env.DB.prepare("UPDATE albums SET artwork_key=? WHERE id=?")
    .bind(key, row.id)
    .run();
  return c.json({ ok: true });
});
app.post("/api/imports/:id/complete", async (c) => {
  const result = await c.env.DB.prepare(
    `UPDATE imports SET status='complete',completed_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='staging' AND NOT EXISTS(
      SELECT 1 FROM tracks t JOIN albums a ON t.album_id=a.id WHERE a.import_id=imports.id AND t.uploaded=0
    )`,
  )
    .bind(c.req.param("id"))
    .run();
  if (!result.meta.changes)
    throw new HTTPException(409, {
      message: "Upload every track before completing this import.",
    });
  return c.json({ ok: true });
});
app.delete("/api/imports/:id", async (c) => {
  // Retain abandoned originals for operator review; there is no committed-audio deletion API.
  const result = await c.env.DB.prepare(
    "UPDATE imports SET status='abandoned' WHERE id=? AND status='staging'",
  )
    .bind(c.req.param("id"))
    .run();
  if (!result.meta.changes)
    throw new HTTPException(409, {
      message: "Only open imports can be abandoned.",
    });
  return c.json({ ok: true });
});
app.on(["GET", "HEAD"], "/api/tracks/:id/audio", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT t.object_key,t.mime,t.bytes,t.sha256 FROM tracks t
    JOIN albums a ON t.album_id=a.id JOIN imports i ON a.import_id=i.id WHERE t.id=? AND i.status='complete'`,
  )
    .bind(c.req.param("id"))
    .first<{
      object_key: string;
      mime: string;
      bytes: number;
      sha256: string;
    }>();
  if (!row) throw new HTTPException(404, { message: "Track not found." });
  const etag = `"${row.sha256}"`;
  let range;
  try {
    const ifRange = c.req.header("If-Range");
    range = byteRange(
      !ifRange || ifRange === etag ? (c.req.header("Range") ?? null) : null,
      row.bytes,
    );
  } catch {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${row.bytes}`,
        "Accept-Ranges": "bytes",
      },
    });
  }
  const headers: Record<string, string> = {
    "Content-Type": row.mime,
    "Content-Length": String(range?.length ?? row.bytes),
    "Accept-Ranges": "bytes",
    ETag: etag,
    "X-Content-SHA256": row.sha256,
  };
  if (range)
    headers["Content-Range"] =
      `bytes ${range.offset}-${range.offset + range.length - 1}/${row.bytes}`;
  if (c.req.method === "HEAD")
    return new Response(null, { status: range ? 206 : 200, headers });
  const object = await c.env.MUSIC.get(
    row.object_key,
    range ? { range } : undefined,
  );
  if (!object)
    throw new HTTPException(404, { message: "Original audio is missing." });
  return new Response(object.body, { status: range ? 206 : 200, headers });
});
app.get("/api/albums/:id/artwork", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT a.artwork_key FROM albums a JOIN imports i ON a.import_id=i.id
    WHERE a.id=? AND i.status='complete'`,
  )
    .bind(c.req.param("id"))
    .first<{ artwork_key: string | null }>();
  const object = row?.artwork_key
    ? await c.env.MUSIC.get(row.artwork_key)
    : null;
  if (!object) throw new HTTPException(404, { message: "Artwork not found." });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
    },
  });
});

app.patch("/api/playlists/:id", async (c) => {
  const { title } = playlistRenameSchema.parse(await jsonBody(c.req.raw, 2048));
  const result = await c.env.DB.prepare(
    "UPDATE playlists SET title=? WHERE id=?",
  )
    .bind(title, c.req.param("id"))
    .run();
  if (!result.meta.changes)
    throw new HTTPException(404, { message: "Playlist not found." });
  return c.json({ ok: true, title });
});
app.delete("/api/playlists/:id", async (c) => {
  const id = c.req.param("id");
  // Explicit child removal keeps referential integrity independent of cascade
  // configuration. Tracks, albums and R2 originals are never touched.
  const [, parent] = await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM playlist_tracks WHERE playlist_id=?").bind(
      id,
    ),
    c.env.DB.prepare("DELETE FROM playlists WHERE id=?").bind(id),
  ]);
  if (!parent.meta.changes)
    throw new HTTPException(404, { message: "Playlist not found." });
  return c.json({ ok: true });
});
app.post("/api/playlists/:id/tracks", async (c) => {
  const id = c.req.param("id");
  const { track_id } = playlistTrackSchema.parse(
    await jsonBody(c.req.raw, 2048),
  );
  if (!(await findPlaylist(c.env.DB, id)))
    throw new HTTPException(404, { message: "Playlist not found." });
  const track = await c.env.DB.prepare(
    `SELECT t.id FROM tracks t JOIN albums a ON a.id=t.album_id
    JOIN imports i ON i.id=a.import_id WHERE t.id=? AND i.status='complete'`,
  )
    .bind(track_id)
    .first<{ id: string }>();
  if (!track)
    throw new HTTPException(404, {
      message: "That track is not in your library.",
    });
  const order = await currentOrder(c.env.DB, id);
  if (order.includes(track_id))
    throw new HTTPException(409, {
      message: "That track is already in this playlist.",
    });
  if (order.length >= MAX_PLAYLIST_TRACKS)
    throw new HTTPException(409, {
      message: `A playlist holds up to ${MAX_PLAYLIST_TRACKS} tracks.`,
    });
  try {
    // The position is computed in the same statement, so concurrent adds cannot
    // reuse an index. The unique index is the final backstop.
    await c.env.DB.prepare(
      `INSERT INTO playlist_tracks(playlist_id,track_id,position)
      VALUES(?,?,(SELECT coalesce(MAX(position)+1,0) FROM playlist_tracks WHERE playlist_id=?))`,
    )
      .bind(id, track_id, id)
      .run();
  } catch {
    throw new HTTPException(409, {
      message: "That track is already in this playlist.",
    });
  }
  return c.json({ ok: true }, 201);
});
app.delete("/api/playlists/:id/tracks/:track", async (c) => {
  const id = c.req.param("id");
  if (!(await findPlaylist(c.env.DB, id)))
    throw new HTTPException(404, { message: "Playlist not found." });
  const result = await c.env.DB.prepare(
    "DELETE FROM playlist_tracks WHERE playlist_id=? AND track_id=?",
  )
    .bind(id, c.req.param("track"))
    .run();
  if (!result.meta.changes)
    throw new HTTPException(404, {
      message: "That track is not in this playlist.",
    });
  await writePositions(c.env.DB, id, await currentOrder(c.env.DB, id));
  return c.json({ ok: true });
});
app.put("/api/playlists/:id/tracks", async (c) => {
  const id = c.req.param("id");
  const { track_ids } = playlistOrderSchema.parse(await jsonBody(c.req.raw));
  if (!(await findPlaylist(c.env.DB, id)))
    throw new HTTPException(404, { message: "Playlist not found." });
  const current = await currentOrder(c.env.DB, id);
  const expected = new Set(current);
  if (
    current.length !== track_ids.length ||
    !track_ids.every((trackId) => expected.has(trackId))
  )
    throw new HTTPException(409, {
      message:
        "This playlist changed while you were editing. Reload and try again.",
    });
  if (!current.every((trackId, index) => trackId === track_ids[index]))
    await writePositions(c.env.DB, id, track_ids);
  return c.json({ ok: true });
});

app.put("/api/state", async (c) => {
  const state = stateSchema.parse(await jsonBody(c.req.raw));
  await c.env.DB.prepare(
    `INSERT INTO listening_state(id,state_json) VALUES(1,?)
    ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_at=CURRENT_TIMESTAMP`,
  )
    .bind(JSON.stringify(state))
    .run();
  return c.json({ ok: true });
});
app.get("/api/state", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT state_json FROM listening_state WHERE id=1",
  ).first<{ state_json: string }>();
  return c.json(
    row
      ? JSON.parse(row.state_json)
      : { queue: [], current: null, position: 0 },
  );
});

const playlistColumns = `p.id,p.title,p.created_at,
  (SELECT count(*) FROM playlist_tracks pt WHERE pt.playlist_id=p.id) AS track_count,
  (SELECT coalesce(sum(t.duration),0) FROM playlist_tracks pt
    JOIN tracks t ON t.id=pt.track_id WHERE pt.playlist_id=p.id) AS duration`;
const trackColumns = `t.id,t.album_id,t.title,t.artist,t.track_number,t.disc_number,
  t.duration,t.filename,t.mime,t.bytes,t.sha256`;

function summary(row: PlaylistSummary): PlaylistSummary {
  return {
    id: row.id,
    title: row.title,
    created_at: row.created_at,
    track_count: Number(row.track_count),
    duration: Number(row.duration),
  };
}
async function findPlaylist(db: D1Database, id: string) {
  return db
    .prepare(`SELECT ${playlistColumns} FROM playlists p WHERE p.id=?`)
    .bind(id)
    .first<PlaylistSummary>();
}
async function playlistTracks(db: D1Database, id: string) {
  const rows = await db
    .prepare(
      `SELECT ${trackColumns} FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
      JOIN albums a ON a.id=t.album_id JOIN imports i ON i.id=a.import_id
      WHERE pt.playlist_id=? AND i.status='complete' ORDER BY pt.position`,
    )
    .bind(id)
    .all<Track>();
  return rows.results;
}
/**
 * Rewrites positions to 0..n-1. The offset pass avoids colliding with the
 * (playlist_id, position) primary key while statements run inside one batch.
 */
async function writePositions(db: D1Database, id: string, trackIds: string[]) {
  await db.batch([
    db
      .prepare(
        "UPDATE playlist_tracks SET position = position + 100000 WHERE playlist_id=?",
      )
      .bind(id),
    ...trackIds.map((trackId, index) =>
      db
        .prepare(
          "UPDATE playlist_tracks SET position=? WHERE playlist_id=? AND track_id=?",
        )
        .bind(index, id, trackId),
    ),
  ]);
}
async function currentOrder(db: D1Database, id: string) {
  const rows = await db
    .prepare(
      "SELECT track_id FROM playlist_tracks WHERE playlist_id=? ORDER BY position",
    )
    .bind(id)
    .all<{ track_id: string }>();
  return rows.results.map((row) => row.track_id);
}

app.get("/api/playlists", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT ${playlistColumns} FROM playlists p ORDER BY p.created_at, p.id`,
  ).all<PlaylistSummary>();
  return c.json({ playlists: rows.results.map(summary) });
});
app.post("/api/playlists", async (c) => {
  const { title } = playlistCreateSchema.parse(await jsonBody(c.req.raw, 2048));
  const count = await c.env.DB.prepare(
    "SELECT count(*) AS total FROM playlists",
  ).first<{ total: number }>();
  if (Number(count?.total ?? 0) >= MAX_PLAYLISTS)
    throw new HTTPException(409, {
      message: `Keep up to ${MAX_PLAYLISTS} playlists.`,
    });
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO playlists(id,title) VALUES(?,?)")
    .bind(id, title)
    .run();
  const row = await findPlaylist(c.env.DB, id);
  if (!row)
    throw new HTTPException(500, {
      message: "The playlist could not be created.",
    });
  return c.json({ playlist: summary(row) }, 201);
});
app.get("/api/playlists/:id", async (c) => {
  const row = await findPlaylist(c.env.DB, c.req.param("id"));
  if (!row) throw new HTTPException(404, { message: "Playlist not found." });
  const tracks = await playlistTracks(c.env.DB, row.id);
  const playlist: Playlist = {
    ...summary(row),
    track_count: tracks.length,
    duration: tracks.reduce((total, track) => total + track.duration, 0),
    tracks,
  };
  return c.json({ playlist });
});

app.all("/api/*", (c) => c.json({ error: "Endpoint not found." }, 404));
app.all("*", async (c) => {
  if (!["GET", "HEAD"].includes(c.req.method))
    return c.text("Method not allowed.", 405);
  // Shell contains no private data. APIs and media always authenticate in Worker.
  return c.env.ASSETS.fetch(c.req.raw);
});
export default app;
