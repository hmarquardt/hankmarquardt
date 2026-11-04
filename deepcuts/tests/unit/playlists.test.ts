import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  authenticate,
  closeDatabases,
  environment,
  origin,
  type Context,
} from "./support";

afterEach(closeDatabases);

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * Creates a complete album through the real import API so playlist tests use
 * committed tracks exactly like the application does.
 */
async function seedAlbum(
  ctx: Context,
  headers: Record<string, string>,
  title: string,
  names: string[],
) {
  const files = names.map((name) =>
    new TextEncoder().encode(`ID3 ${title} ${name}`),
  );
  const created = await ctx.request("/api/imports", {
    method: "POST",
    headers,
    body: JSON.stringify({
      title,
      artist: "Playlist ensemble",
      year: 2026,
      tracks: names.map((name, index) => ({
        title: name,
        artist: "Playlist ensemble",
        track_number: index + 1,
        disc_number: 1,
        duration: 30,
        filename: `${String(index + 1).padStart(2, "0")}-${name}.mp3`,
        mime: "audio/mpeg",
        bytes: files[index].byteLength,
        sha256: digest(files[index]),
      })),
    }),
  });
  expect(created.status).toBe(201);
  const manifest = (await created.json()) as {
    id: string;
    album_id: string;
    tracks: { id: string; filename: string }[];
  };
  for (const [index, track] of manifest.tracks.entries()) {
    const upload = await ctx.request(
      `/api/imports/${manifest.id}/tracks/${track.id}`,
      {
        method: "PUT",
        headers: {
          Cookie: headers.Cookie,
          Origin: origin,
          "Content-Length": String(files[index].byteLength),
        },
        body: files[index],
      },
    );
    expect(upload.status).toBe(200);
  }
  const complete = await ctx.request(`/api/imports/${manifest.id}/complete`, {
    method: "POST",
    headers,
  });
  expect(complete.status).toBe(200);
  return {
    albumId: manifest.album_id,
    trackIds: manifest.tracks.map((track) => track.id),
  };
}

async function session(ctx: Context) {
  const cookie = await authenticate(ctx);
  return {
    Cookie: cookie,
    Origin: origin,
    "Content-Type": "application/json",
  } as Record<string, string>;
}

async function createPlaylist(
  ctx: Context,
  headers: Record<string, string>,
  title: string,
) {
  const response = await ctx.request("/api/playlists", {
    method: "POST",
    headers,
    body: JSON.stringify({ title }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    playlist: { id: string; title: string; track_count: number };
  };
  return body.playlist;
}

const addTrack = (
  ctx: Context,
  headers: Record<string, string>,
  playlistId: string,
  trackId: string,
) =>
  ctx.request(`/api/playlists/${playlistId}/tracks`, {
    method: "POST",
    headers,
    body: JSON.stringify({ track_id: trackId }),
  });

const readPlaylist = async (
  ctx: Context,
  headers: Record<string, string>,
  playlistId: string,
) =>
  (await (
    await ctx.request(`/api/playlists/${playlistId}`, { headers })
  ).json()) as {
    playlist: {
      id: string;
      title: string;
      track_count: number;
      duration: number;
      tracks: { id: string; title: string }[];
    };
  };
describe("playlist authentication", () => {
  it("requires the owner session for every playlist route", async () => {
    const ctx = environment();
    const headers = { Origin: origin, "Content-Type": "application/json" };
    for (const [path, method, body] of [
      ["/api/playlists", "GET", undefined],
      ["/api/playlists", "POST", JSON.stringify({ title: "Mine" })],
      ["/api/playlists/id", "GET", undefined],
      ["/api/playlists/id", "PATCH", JSON.stringify({ title: "Mine" })],
      ["/api/playlists/id", "DELETE", undefined],
      [
        "/api/playlists/id/tracks",
        "POST",
        JSON.stringify({ track_id: crypto.randomUUID() }),
      ],
      ["/api/playlists/id/tracks/track", "DELETE", undefined],
      ["/api/playlists/id/tracks", "PUT", JSON.stringify({ track_ids: [] })],
    ] as const) {
      const response = await ctx.request(path, { method, headers, body });
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(
      ctx.sql.prepare("SELECT count(*) AS n FROM playlists").get(),
    ).toEqual({
      n: 0,
    });
  });
});

describe("playlist lifecycle", () => {
  it("creates, lists, renames and deletes a playlist without touching music", async () => {
    const ctx = environment();
    const headers = await session(ctx);
    const { trackIds } = await seedAlbum(ctx, headers, "First record", [
      "Opening",
      "Closer",
    ]);
    const empty = (await (
      await ctx.request("/api/playlists", { headers })
    ).json()) as { playlists: unknown[] };
    expect(empty.playlists).toEqual([]);
    const playlist = await createPlaylist(ctx, headers, "  Sunday morning  ");
    expect(playlist).toMatchObject({
      title: "Sunday morning",
      track_count: 0,
    });
    expect(
      (await addTrack(ctx, headers, playlist.id, trackIds[0])).status,
    ).toBe(201);
    const list = (await (
      await ctx.request("/api/playlists", { headers })
    ).json()) as {
      playlists: { id: string; track_count: number; duration: number }[];
    };
    expect(list.playlists).toHaveLength(1);
    expect(list.playlists[0]).toMatchObject({ track_count: 1, duration: 30 });

    const renamed = await ctx.request(`/api/playlists/${playlist.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: "Sunday afternoon" }),
    });
    expect(renamed.status).toBe(200);
    expect((await readPlaylist(ctx, headers, playlist.id)).playlist.title).toBe(
      "Sunday afternoon",
    );

    const deleted = await ctx.request(`/api/playlists/${playlist.id}`, {
      method: "DELETE",
      headers,
    });
    expect(deleted.status).toBe(200);
    expect(
      ctx.sql.prepare("SELECT count(*) AS n FROM playlist_tracks").get(),
    ).toEqual({ n: 0 });
    // Music, albums and stored originals are untouched.
    expect(ctx.sql.prepare("SELECT count(*) AS n FROM tracks").get()).toEqual({
      n: 2,
    });
    expect(ctx.objects.size).toBe(2);
    expect(
      (
        await ctx.request(`/api/tracks/${trackIds[0]}/audio`, {
          headers: { Cookie: headers.Cookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (await ctx.request(`/api/playlists/${playlist.id}`, { headers })).status,
    ).toBe(404);
    expect(
      (
        await ctx.request(`/api/playlists/${playlist.id}`, {
          method: "DELETE",
          headers,
        })
      ).status,
    ).toBe(404);
  });

  it("validates titles and rejects unknown fields or malformed bodies", async () => {
    const ctx = environment();
    const headers = await session(ctx);
    for (const body of [
      JSON.stringify({ title: "" }),
      JSON.stringify({ title: "   " }),
      JSON.stringify({ title: "x".repeat(121) }),
      JSON.stringify({ title: "Fine", extra: true }),
      JSON.stringify({ name: "Wrong field" }),
      "{not json",
    ]) {
      const response = await ctx.request("/api/playlists", {
        method: "POST",
        headers,
        body,
      });
      expect(response.status).toBe(400);
    }
    const playlist = await createPlaylist(ctx, headers, "Valid");
    for (const body of [
      JSON.stringify({ title: "" }),
      JSON.stringify({ title: "x".repeat(121) }),
      JSON.stringify({ title: "Ok", extra: 1 }),
    ]) {
      const response = await ctx.request(`/api/playlists/${playlist.id}`, {
        method: "PATCH",
        headers,
        body,
      });
      expect(response.status).toBe(400);
    }
    expect(
      ctx.sql.prepare("SELECT count(*) AS n FROM playlists").get(),
    ).toEqual({ n: 1 });
  });
});

describe("playlist membership", () => {
  it("adds tracks from any album, rejects duplicates, and reports counts", async () => {
    const ctx = environment();
    const headers = await session(ctx);
    const first = await seedAlbum(ctx, headers, "First record", [
      "Opening",
      "Closer",
    ]);
    const second = await seedAlbum(ctx, headers, "Second record", ["Detour"]);
    const playlist = await createPlaylist(ctx, headers, "Mix");
    expect(
      (await addTrack(ctx, headers, playlist.id, first.trackIds[0])).status,
    ).toBe(201);
    expect(
      (await addTrack(ctx, headers, playlist.id, second.trackIds[0])).status,
    ).toBe(201);
    expect(
      (await addTrack(ctx, headers, playlist.id, first.trackIds[0])).status,
    ).toBe(409);
    const detail = await readPlaylist(ctx, headers, playlist.id);
    expect(detail.playlist.tracks.map((track) => track.title)).toEqual([
      "Opening",
      "Detour",
    ]);
    expect(detail.playlist).toMatchObject({ track_count: 2, duration: 60 });

    const other = await createPlaylist(ctx, headers, "Second mix");
    // The same track can live in several playlists.
    expect(
      (await addTrack(ctx, headers, other.id, first.trackIds[0])).status,
    ).toBe(201);
    expect(
      ctx.sql
        .prepare("SELECT count(*) AS n FROM playlist_tracks WHERE track_id=?")
        .get(first.trackIds[0]),
    ).toEqual({ n: 2 });
  });

  it("refuses unknown, malformed and still-staging tracks", async () => {
    const ctx = environment();
    const headers = await session(ctx);
    const playlist = await createPlaylist(ctx, headers, "Strict mix");
    const missing = await addTrack(
      ctx,
      headers,
      playlist.id,
      crypto.randomUUID(),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      error: "That track is not in your library.",
    });
    const malformed = await ctx.request(
      `/api/playlists/${playlist.id}/tracks`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ track_id: "not-a-uuid" }),
      },
    );
    expect(malformed.status).toBe(400);
    // A staging import has not been committed to the library yet.
    const created = await ctx.request("/api/imports", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Still uploading",
        artist: "Ensemble",
        year: null,
        tracks: [
          {
            title: "Unfinished",
            artist: "Ensemble",
            track_number: 1,
            disc_number: 1,
            duration: 20,
            filename: "01-unfinished.mp3",
            mime: "audio/mpeg",
            bytes: 10,
            sha256: "a".repeat(64),
          },
        ],
      }),
    });
    const staging = (await created.json()) as { tracks: { id: string }[] };
    expect(
      (await addTrack(ctx, headers, playlist.id, staging.tracks[0].id)).status,
    ).toBe(404);
    expect(
      (await addTrack(ctx, headers, crypto.randomUUID(), crypto.randomUUID()))
        .status,
    ).toBe(404);
    expect(
      ctx.sql.prepare("SELECT count(*) AS n FROM playlist_tracks").get(),
    ).toEqual({ n: 0 });
  });

  it("removes a track, compacts positions, and keeps the original music", async () => {
    const ctx = environment();
    const headers = await session(ctx);
    const { trackIds } = await seedAlbum(ctx, headers, "Three tracks", [
      "One",
      "Two",
      "Three",
    ]);
    const playlist = await createPlaylist(ctx, headers, "Ordered");
    for (const id of trackIds)
      expect((await addTrack(ctx, headers, playlist.id, id)).status).toBe(201);
    const removed = await ctx.request(
      `/api/playlists/${playlist.id}/tracks/${trackIds[1]}`,
      { method: "DELETE", headers },
    );
    expect(removed.status).toBe(200);
    const detail = await readPlaylist(ctx, headers, playlist.id);
    expect(detail.playlist.tracks.map((track) => track.title)).toEqual([
      "One",
      "Three",
    ]);
    expect(
      ctx.sql
        .prepare(
          "SELECT position FROM playlist_tracks WHERE playlist_id=? ORDER BY position",
        )
        .all(playlist.id),
    ).toEqual([{ position: 0 }, { position: 1 }]);
    expect(
      (
        await ctx.request(
          `/api/playlists/${playlist.id}/tracks/${trackIds[1]}`,
          { method: "DELETE", headers },
        )
      ).status,
    ).toBe(404);
    // The removed track still exists in the library and streams its original.
    const library = (await (
      await ctx.request("/api/library", { headers })
    ).json()) as { albums: { tracks: { id: string }[] }[] };
    expect(library.albums[0].tracks.map((track) => track.id)).toContain(
      trackIds[1],
    );
    expect(
      (
        await ctx.request(`/api/tracks/${trackIds[1]}/audio`, {
          headers: { Cookie: headers.Cookie },
        })
      ).status,
    ).toBe(200);
  });
});

describe("playlist ordering", () => {
  it("reorders with a full track list and persists the new positions", async () => {
    const ctx = environment();
    const headers = await session(ctx);
    const { trackIds } = await seedAlbum(ctx, headers, "Reorder", [
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    const playlist = await createPlaylist(ctx, headers, "Running order");
    for (const id of trackIds) await addTrack(ctx, headers, playlist.id, id);
    const reversed = [...trackIds].reverse();
    const response = await ctx.request(`/api/playlists/${playlist.id}/tracks`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ track_ids: reversed }),
    });
    expect(response.status).toBe(200);
    const detail = await readPlaylist(ctx, headers, playlist.id);
    expect(detail.playlist.tracks.map((track) => track.id)).toEqual(reversed);
    expect(
      ctx.sql
        .prepare(
          "SELECT track_id, position FROM playlist_tracks WHERE playlist_id=? ORDER BY position",
        )
        .all(playlist.id),
    ).toEqual(reversed.map((id, position) => ({ track_id: id, position })));
    // Re-sending the same order is a safe no-op.
    expect(
      (
        await ctx.request(`/api/playlists/${playlist.id}/tracks`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ track_ids: reversed }),
        })
      ).status,
    ).toBe(200);
  });

  it("rejects stale or ambiguous order requests without changing anything", async () => {
    const ctx = environment();
    const headers = await session(ctx);
    const { trackIds } = await seedAlbum(ctx, headers, "Stale", ["A", "B"]);
    const playlist = await createPlaylist(ctx, headers, "Guarded");
    for (const id of trackIds) await addTrack(ctx, headers, playlist.id, id);
    const rejected = [
      { track_ids: [trackIds[0]] },
      { track_ids: [...trackIds, crypto.randomUUID()] },
      { track_ids: [trackIds[0], trackIds[0]] },
      { track_ids: [], extra: true },
    ];
    for (const body of rejected) {
      const response = await ctx.request(
        `/api/playlists/${playlist.id}/tracks`,
        { method: "PUT", headers, body: JSON.stringify(body) },
      );
      expect([400, 409]).toContain(response.status);
    }
    const detail = await readPlaylist(ctx, headers, playlist.id);
    expect(detail.playlist.tracks.map((track) => track.id)).toEqual(trackIds);
  });
});

describe("playlist isolation", () => {
  it("deletes only the selected playlist and its membership rows", async () => {
    const ctx = environment();
    const headers = await session(ctx);
    const { trackIds } = await seedAlbum(ctx, headers, "Shared", [
      "Shared song",
    ]);
    const keep = await createPlaylist(ctx, headers, "Keep");
    const drop = await createPlaylist(ctx, headers, "Drop");
    await addTrack(ctx, headers, keep.id, trackIds[0]);
    await addTrack(ctx, headers, drop.id, trackIds[0]);
    expect(
      (
        await ctx.request(`/api/playlists/${drop.id}`, {
          method: "DELETE",
          headers,
        })
      ).status,
    ).toBe(200);
    expect(
      (await readPlaylist(ctx, headers, keep.id)).playlist.tracks,
    ).toHaveLength(1);
    expect(
      ctx.sql.prepare("SELECT count(*) AS n FROM playlists").get(),
    ).toEqual({ n: 1 });
    expect(
      ctx.sql.prepare("SELECT count(*) AS n FROM playlist_tracks").get(),
    ).toEqual({ n: 1 });
    expect(ctx.sql.prepare("SELECT count(*) AS n FROM tracks").get()).toEqual({
      n: 1,
    });
    expect(ctx.objects.size).toBe(1);
  });

  it("reports a missing playlist consistently on every nested route", async () => {
    const ctx = environment();
    const headers = await session(ctx);
    const { trackIds } = await seedAlbum(ctx, headers, "Missing", ["Song"]);
    const id = crypto.randomUUID();
    expect(
      (await ctx.request(`/api/playlists/${id}`, { headers })).status,
    ).toBe(404);
    expect((await addTrack(ctx, headers, id, trackIds[0])).status).toBe(404);
    expect(
      (
        await ctx.request(`/api/playlists/${id}/tracks/${trackIds[0]}`, {
          method: "DELETE",
          headers,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await ctx.request(`/api/playlists/${id}/tracks`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ track_ids: trackIds }),
        })
      ).status,
    ).toBe(404);
  });
});
