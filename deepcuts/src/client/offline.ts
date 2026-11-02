import { openDB, type DBSchema } from "idb";
import {
  sha256,
  type Album,
  type ListeningState,
  type Track,
} from "../shared/model";

export interface Download {
  album: Album;
  artwork: Blob | null;
  downloaded_at: string;
}
interface LocalDB extends DBSchema {
  albums: { key: string; value: Download };
  files: { key: string; value: { blob: Blob; sha256: string } };
  settings: { key: string; value: ListeningState };
}
const dbPromise = openDB<LocalDB>("deepcuts-device-v1", 1, {
  upgrade(db) {
    db.createObjectStore("albums");
    db.createObjectStore("files");
    db.createObjectStore("settings");
  },
});
export async function downloads(): Promise<Download[]> {
  return (await dbPromise).getAll("albums");
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
export async function downloadAlbum(
  album: Album,
  progress: (message: string) => void,
): Promise<void> {
  const db = await dbPromise;
  if (await db.get("albums", album.id)) return;
  const estimate = await navigator.storage?.estimate();
  const needed = album.tracks.reduce((sum, t) => sum + t.bytes, 0);
  if (estimate?.quota && estimate.quota - (estimate.usage ?? 0) < needed * 1.1)
    throw new Error("There is not enough device storage for this album.");
  await navigator.storage?.persist?.().catch(() => false);
  try {
    for (const [i, track] of album.tracks.entries()) {
      progress(
        `Downloading ${i + 1} of ${album.tracks.length} · ${track.title}`,
      );
      const response = await fetch(`/api/tracks/${track.id}/audio`, {
        cache: "no-store",
      });
      if (!response.ok || response.status !== 200)
        throw new Error("Download interrupted. Sign in and try again.");
      const blob = await response.blob();
      if (
        blob.size !== track.bytes ||
        (await sha256(await blob.arrayBuffer())) !== track.sha256
      )
        throw new Error("Download integrity check failed. Try again.");
      await db.put("files", { blob, sha256: track.sha256 }, track.id);
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
    const tx = db.transaction("files", "readwrite");
    for (const track of album.tracks) void tx.store.delete(track.id);
    await tx.done;
    throw error;
  }
}
export async function removeDownload(album: Album) {
  const tx = (await dbPromise).transaction(["albums", "files"], "readwrite");
  void tx.objectStore("albums").delete(album.id);
  for (const track of album.tracks)
    void tx.objectStore("files").delete(track.id);
  await tx.done;
}
export async function verifyDownload(album: Album) {
  for (const track of album.tracks)
    if (!(await offlineAudio(track)))
      throw new Error(
        "A downloaded file is missing. Download the album again.",
      );
}
export async function clearDevice() {
  const tx = (await dbPromise).transaction(
    ["albums", "files", "settings"],
    "readwrite",
  );
  for (const store of ["albums", "files", "settings"] as const)
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
  const complete = new Set(
    (await db.getAll("albums")).flatMap((d) => d.album.tracks.map((t) => t.id)),
  );
  const keys = await db.getAllKeys("files");
  const tx = db.transaction("files", "readwrite");
  for (const key of keys) if (!complete.has(key)) void tx.store.delete(key);
  await tx.done;
}
