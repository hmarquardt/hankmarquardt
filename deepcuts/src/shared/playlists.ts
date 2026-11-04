import type { Track } from "./model";

// Pure playlist helpers shared by the browser and unit tests. Everything here is
// free of IDB, network and React so it can be verified in Node.

/** Fisher-Yates shuffle of a copy. A random source is injectable for tests. */
export function shuffle<T>(
  items: readonly T[],
  random: () => number = Math.random,
): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function playlistDuration(
  tracks: readonly { duration: number }[],
): number {
  return tracks.reduce(
    (total, track) =>
      total + (Number.isFinite(track.duration) ? track.duration : 0),
    0,
  );
}

/** Deduplicate tracks by id, keeping the first occurrence. */
export function uniqueTracks(
  ...collections: readonly (readonly Track[])[]
): Track[] {
  const unique = new Map<string, Track>();
  for (const collection of collections)
    for (const track of collection)
      if (!unique.has(track.id)) unique.set(track.id, track);
  return [...unique.values()];
}

export function totalTrackBytes(tracks: readonly Track[]): number {
  return tracks.reduce((total, track) => total + track.bytes, 0);
}

export interface StoredTrack {
  bytes: number;
  sha256: string;
}

/**
 * Tracks that are not already stored as the exact original on this device.
 * Matching size and digest means a playlist download can reuse audio that an
 * album download (or another playlist) already saved.
 */
export function tracksToDownload(
  tracks: readonly Track[],
  stored: ReadonlyMap<string, StoredTrack>,
): Track[] {
  return uniqueTracks(tracks).filter((track) => {
    const local = stored.get(track.id);
    return (
      !local || local.bytes !== track.bytes || local.sha256 !== track.sha256
    );
  });
}

/** True when two playlists reference exactly the same tracks in the same order. */
export function sameTracks(
  left: readonly { id: string }[],
  right: readonly { id: string }[],
): boolean {
  return (
    left.length === right.length &&
    left.every((track, index) => track.id === right[index]?.id)
  );
}

/** Returns a human summary such as "3 tracks · 12 min". */
export function playlistSummaryText(
  trackCount: number,
  duration: number,
): string {
  const minutes = Math.max(0, Math.ceil(duration / 60));
  return `${trackCount} ${trackCount === 1 ? "track" : "tracks"} · ${minutes} min`;
}
