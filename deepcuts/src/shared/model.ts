export interface Track {
  id: string;
  album_id: string;
  title: string;
  artist: string;
  track_number: number;
  disc_number: number;
  duration: number;
  filename: string;
  mime: string;
  bytes: number;
  sha256: string;
}
export interface Album {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  has_artwork: boolean;
  tracks: Track[];
}
export interface PlaylistSummary {
  id: string;
  title: string;
  created_at: string;
  track_count: number;
  duration: number;
}
export interface Playlist extends PlaylistSummary {
  tracks: Track[];
}
export interface ListeningState {
  queue: string[];
  current: string | null;
  position: number;
  queue_index?: number;
}
// A streaming R2 write with a streaming SHA-256 check stays inside the Worker's
// 128 MB memory budget, so 64 MiB is safe. Cloudflare also caps request bodies at
// 100 MB on the Free and Pro plans. See docs/ARCHITECTURE.md.
export const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
export const MAX_ART_BYTES = 5 * 1024 * 1024;
export const MAX_PLAYLIST_TRACKS = 500;
export const MAX_PLAYLISTS = 200;
export async function sha256(value: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", value))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}
export function formatBytes(bytes: number): string {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
