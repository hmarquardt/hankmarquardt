import { openDB, type DBSchema } from "idb";
import {
  sha256,
  type Album,
  type ListeningState,
  type Playlist,
  type Track,
} from "../shared/model";
import {
  sameTracks,
  tracksToDownload,
  type StoredTrack,
} from "../shared/playlists";

export interface Download {
  album: Album;
  artwork: Blob | null;
  downloaded_at: string;
}
export interface PlaylistDownload {
  playlist: Playlist;
  downloaded_at: string;
}
interface LocalDB extends DBSchema {
  albums: { key: string; value: Download };
  files: { key: string; value: { blob: Blob; sha256: string } };
  playlists: { key: string; value: PlaylistDownload };
  settings: { key: string; value: ListeningState };
}
// One file store keyed by track id is shared by album and playlist downloads:
// the same original is never stored twice on a device.
const dbPromise = openDB<LocalDB>("deepcuts-device-v1", 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore("albums");
      db.createObjectStore("files");
      db.createObjectStore("settings");
    }
    if (oldVersion < 2) db.createObjectStore("playlists");
  },
});
export async function downloads(): Promise<Download[]> {
  return (await dbPromise).getAll("albums");
}
export async function playlistDownloads(): Promise<PlaylistDownload[]> {
  return (await dbPromise).getAll("playlists");
}
export async function offlineAudio(track: Track): Promise<Blob | null> {
  const row = await (await dbPromise).get("files", track.id);
  if (!row) return null;
  if (
    row.blob.size !== track.bytes ||
    row.sha256 !== track.sha256 ||
    (await sha256(await row.blob.arrayBuffer())) !== track.sha256
  ) {
    throw new Error(
      "This download failed its integrity check. Remove and download the album again.",
    );
  }
  return row.blob;
}
async function storedTracks(): Promise<Map<string, StoredTrack>> {
  const db = await dbPromise;
  const index = new Map<string, StoredTrack>();
  let cursor = await db.transaction("files").store.openCursor();
  while (cursor) {
    index.set(String(cursor.key), {
      bytes: cursor.value.blob.size,
      sha256: cursor.value.sha256,
    });
    cursor = await cursor.continue();
  }
  return index;
}
/** Track ids still referenced by a complete album or playlist download. */
async function referencedTracks(): Promise<Set<string>> {
  const db = await dbPromise;
  const albums = await db.getAll("albums");
  const playlists = await db.getAll("playlists");
  return new Set([
    ...albums.flatMap((download) => download.album.tracks.map((t) => t.id)),
    ...playlists.flatMap((download) =>
      download.playlist.tracks.map((t) => t.id),
    ),
  ]);
}
/** Deletes only files no remaining download needs. Shared audio is retained. */
async function releaseFiles(candidates: Iterable<string>) {
  const referenced = await referencedTracks();
  const db = await dbPromise;
  const tx = db.transaction("files", "readwrite");
  for (const id of new Set(candidates))
    if (!referenced.has(id)) void tx.store.delete(id);
  await tx.done;
}
async function fetchVerified(track: Track, message: string): Promise<Blob> {
  const response = await fetch(`/api/tracks/${track.id}/audio`, {
    cache: "no-store",
  });
  if (!response.ok || response.status !== 200) throw new Error(message);
  const blob = await response.blob();
  if (
    blob.size !== track.bytes ||
    (await sha256(await blob.arrayBuffer())) !== track.sha256
  )
    throw new Error("Download integrity check failed. Try again.");
  return blob;
}
async function ensureStorage(neededBytes: number, what: "album" | "playlist") {
  const estimate = await navigator.storage?.estimate();
  if (
    estimate?.quota &&
    estimate.quota - (estimate.usage ?? 0) < neededBytes * 1.1
  )
    throw new Error(`There is not enough device storage for this ${what}.`);
  await navigator.storage?.persist?.().catch(() => false);
}

export async function downloadAlbum(
  album: Album,
  progress: (message: string) => void,
): Promise<void> {
  const db = await dbPromise;
  if (await db.get("albums", album.id)) return;
  const needed = tracksToDownload(album.tracks, await storedTracks());
  await ensureStorage(
    needed.reduce((sum, track) => sum + track.bytes, 0),
    "album",
  );
  const written: string[] = [];
  try {
    for (const [i, track] of needed.entries()) {
      progress(`Downloading ${i + 1} of ${needed.length} · ${track.title}`);
      const blob = await fetchVerified(
        track,
        "Download interrupted. Sign in and try again.",
      );
      await db.put("files", { blob, sha256: track.sha256 }, track.id);
      written.push(track.id);
    }
    let artwork: Blob | null = null;
    if (album.has_artwork) {
      const response = await fetch(`/api/albums/${album.id}/artwork`, {
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error("Artwork download interrupted. Try again.");
      artwork = await response.blob();
    }
    // The completion record is last. Incomplete downloads never appear available.
    await db.put(
      "albums",
      { album, artwork, downloaded_at: new Date().toISOString() },
      album.id,
    );
  } catch (error) {
    await releaseFiles(written);
    throw error;
  }
}
export async function downloadPlaylist(
  playlist: Playlist,
  progress: (message: string) => void,
): Promise<void> {
  const db = await dbPromise;
  const existing = await db.get("playlists", playlist.id);
  if (existing && sameTracks(existing.playlist.tracks, playlist.tracks)) return;
  // Reuse every original already saved by an album or another playlist.
  const needed = tracksToDownload(playlist.tracks, await storedTracks());
  await ensureStorage(
    needed.reduce((sum, track) => sum + track.bytes, 0),
    "playlist",
  );
  const written: string[] = [];
  try {
    for (const [i, track] of needed.entries()) {
      progress(`Downloading ${i + 1} of ${needed.length} · ${track.title}`);
      const blob = await fetchVerified(
        track,
        "Download interrupted. Sign in and try again.",
      );
      await db.put("files", { blob, sha256: track.sha256 }, track.id);
      written.push(track.id);
    }
    // Writing the record last means a partial playlist never looks playable.
    await db.put(
      "playlists",
      { playlist, downloaded_at: new Date().toISOString() },
      playlist.id,
    );
  } catch (error) {
    await releaseFiles(written);
    throw error;
  }
}
export async function removeDownload(album: Album) {
  const db = await dbPromise;
  await db.delete("albums", album.id);
  await releaseFiles(album.tracks.map((track) => track.id));
}
export async function removePlaylistDownload(playlist: Playlist) {
  const db = await dbPromise;
  await db.delete("playlists", playlist.id);
  await releaseFiles(playlist.tracks.map((track) => track.id));
}
export async function verifyDownload(album: Album) {
  for (const track of album.tracks)
    if (!(await offlineAudio(track)))
      throw new Error(
        "A downloaded file is missing. Download the album again.",
      );
}
export async function verifyPlaylistDownload(playlist: Playlist) {
  for (const track of playlist.tracks)
    if (!(await offlineAudio(track)))
      throw new Error(
        "A downloaded file is missing. Download the playlist again.",
      );
}
export async function clearDevice() {
  const tx = (await dbPromise).transaction(
    ["albums", "files", "playlists", "settings"],
    "readwrite",
  );
  for (const store of ["albums", "files", "playlists", "settings"] as const)
    void tx.objectStore(store).clear();
  await tx.done;
}
export async function localState(): Promise<ListeningState | undefined> {
  return (await dbPromise).get("settings", "player");
}
export async function saveLocalState(state: ListeningState) {
  await (await dbPromise).put("settings", state, "player");
}
export async function recoverDownloads() {
  // Remove orphaned partial files after a killed tab. Called once at startup.
  const db = await dbPromise;
  const referenced = await referencedTracks();
  const keys = await db.getAllKeys("files");
  const tx = db.transaction("files", "readwrite");
  for (const key of keys)
    if (!referenced.has(String(key))) void tx.store.delete(key);
  await tx.done;
}
