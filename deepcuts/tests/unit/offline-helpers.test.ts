import { describe, expect, it } from "vitest";
import {
  playlistDuration,
  playlistSummaryText,
  sameTracks,
  shuffle,
  totalTrackBytes,
  tracksToDownload,
  uniqueTracks,
} from "../../src/shared/playlists";
import type { Track } from "../../src/shared/model";

function track(id: string, bytes = 100, sha256 = "a".repeat(64)): Track {
  return {
    id,
    album_id: "album",
    title: id,
    artist: "Artist",
    track_number: 1,
    disc_number: 1,
    duration: 30,
    filename: `${id}.mp3`,
    mime: "audio/mpeg",
    bytes,
    sha256,
  };
}

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("shuffle", () => {
  it("returns a permutation without mutating the source", () => {
    const source = ["a", "b", "c", "d", "e"];
    const result = shuffle(source, seeded(7));
    expect(source).toEqual(["a", "b", "c", "d", "e"]);
    expect([...result].sort()).toEqual([...source].sort());
    expect(result).toHaveLength(source.length);
  });
  it("is deterministic for a fixed random source and handles tiny lists", () => {
    const first = shuffle([1, 2, 3, 4, 5, 6], seeded(42));
    const second = shuffle([1, 2, 3, 4, 5, 6], seeded(42));
    expect(first).toEqual(second);
    expect(shuffle([], seeded(1))).toEqual([]);
    expect(shuffle(["only"], seeded(1))).toEqual(["only"]);
  });
  it("actually changes the order of a larger list at least once", () => {
    const source = Array.from({ length: 20 }, (_, index) => index);
    expect(shuffle(source, seeded(3))).not.toEqual(source);
  });
});

describe("download bookkeeping", () => {
  it("deduplicates tracks across albums and playlists", () => {
    const shared = track("shared", 2048);
    const unique = uniqueTracks(
      [shared, track("album-only")],
      [shared, track("playlist-only")],
    );
    expect(unique.map((item) => item.id)).toEqual([
      "shared",
      "album-only",
      "playlist-only",
    ]);
    expect(totalTrackBytes(unique)).toBe(2048 + 200);
  });
  it("downloads only tracks missing from the device", () => {
    const present = track("present", 4096);
    const changed = track("changed", 4096);
    const absent = track("absent", 4096);
    const stored = new Map([
      ["present", { bytes: 4096, sha256: present.sha256 }],
      ["changed", { bytes: 8192, sha256: changed.sha256 }],
    ]);
    const needed = tracksToDownload(
      [present, changed, absent, present],
      stored,
    );
    expect(needed.map((item) => item.id)).toEqual(["changed", "absent"]);
  });
  it("treats size and digest as the identity of a stored original", () => {
    const item = track("same", 512, "b".repeat(64));
    const stored = new Map([["same", { bytes: 512, sha256: "c".repeat(64) }]]);
    expect(tracksToDownload([item], stored).map((entry) => entry.id)).toEqual([
      "same",
    ]);
  });
  it("compares playlist order and summarizes duration", () => {
    expect(sameTracks([track("a"), track("b")], [track("a"), track("b")])).toBe(
      true,
    );
    expect(sameTracks([track("a"), track("b")], [track("b"), track("a")])).toBe(
      false,
    );
    expect(sameTracks([], [])).toBe(true);
    expect(playlistDuration([{ duration: 30 }, { duration: Number.NaN }])).toBe(
      30,
    );
    expect(playlistSummaryText(1, 30)).toBe("1 track · 1 min");
    expect(playlistSummaryText(3, 610)).toBe("3 tracks · 11 min");
  });
});
