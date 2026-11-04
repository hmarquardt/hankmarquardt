import { api, jsonOptions } from "./api";
import {
  MAX_ART_BYTES,
  MAX_AUDIO_BYTES,
  formatBytes,
  sha256,
} from "../shared/model";

export async function importAlbum(
  files: File[],
  title: string,
  artist: string,
  progress: (text: string) => void,
) {
  const audio = files
    .filter((f) => /\.(mp3|m4a|aac|flac)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!audio.length)
    throw new Error("Choose MP3, AAC/M4A, or FLAC audio files.");
  if (audio.length > 100) throw new Error("Import up to 100 tracks at a time.");
  if (audio.some((f) => f.size > MAX_AUDIO_BYTES))
    throw new Error(
      `Tracks are limited to ${formatBytes(MAX_AUDIO_BYTES)} each. Your originals have not been changed.`,
    );
  const { parseBlob, selectCover } = await import("music-metadata");
  let cover: Blob | null = null;
  let albumTitle = title.trim();
  let albumArtist = artist.trim();
  let year: number | null = null;
  const tracks = [];
  for (const [i, file] of audio.entries()) {
    progress(`Reading tags · ${file.name}`);
    const mime = /\.flac$/i.test(file.name)
      ? "audio/flac"
      : /\.m4a$/i.test(file.name)
        ? "audio/mp4"
        : /\.aac$/i.test(file.name)
          ? "audio/aac"
          : "audio/mpeg";
    const metadata = await parseBlob(new Blob([file], { type: mime }), {
      duration: true,
    });
    const tags = metadata.common;
    albumTitle ||= tags.album?.trim() ?? "";
    albumArtist ||= tags.albumartist?.trim() || tags.artist?.trim() || "";
    if (!title.trim() && tags.album && tags.album.trim() !== albumTitle)
      throw new Error(
        "These files contain more than one album. Choose one album at a time, or supply an album title.",
      );
    year ??= tags.year ?? null;
    const picture = selectCover(tags.picture);
    if (
      !cover &&
      picture &&
      ["image/jpeg", "image/png"].includes(picture.format) &&
      picture.data.byteLength <= MAX_ART_BYTES
    ) {
      cover = new Blob([new Uint8Array(picture.data)], {
        type: picture.format,
      });
    }
    if (!metadata.format.duration || !Number.isFinite(metadata.format.duration))
      throw new Error(
        `Could not read the duration of ${file.name}. Check that the file is playable.`,
      );
    tracks.push({
      title: tags.title?.trim() || file.name.replace(/\.[^.]+$/, ""),
      artist: tags.artist?.trim() || albumArtist || "Unknown artist",
      track_number: tags.track.no || i + 1,
      disc_number: tags.disk.no || 1,
      duration: metadata.format.duration,
      filename: file.name,
      mime,
      bytes: file.size,
      sha256: await sha256(await file.arrayBuffer()),
    });
  }
  if (!albumTitle || !albumArtist)
    throw new Error(
      "These files need an album title and artist. Enter them above and try again.",
    );
  if (new Set(audio.map((f) => f.name)).size !== audio.length)
    throw new Error("Choose one album with unique filenames.");
  const externalCover = files.find((f) =>
    /^(cover|folder)\.(jpg|jpeg|png)$/i.test(f.name),
  );
  if (!cover && externalCover && externalCover.size <= MAX_ART_BYTES)
    cover = externalCover;
  const created = await api<{
    id: string;
    tracks: { id: string; filename: string }[];
  }>(
    "/imports",
    jsonOptions("POST", {
      title: albumTitle,
      artist: albumArtist,
      year,
      tracks,
    }),
  );
  try {
    for (const [i, track] of created.tracks.entries()) {
      progress(
        `Uploading original ${i + 1} of ${audio.length} · ${track.filename}`,
      );
      await api(`/imports/${created.id}/tracks/${track.id}`, {
        method: "PUT",
        body: audio[i],
      });
    }
    if (cover) {
      progress("Saving album artwork");
      await api(`/imports/${created.id}/artwork`, {
        method: "PUT",
        body: cover,
      });
    }
    await api(`/imports/${created.id}/complete`, { method: "POST" });
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : "Import interrupted."} This unfinished import is hidden from your library; choose the album again to retry.`,
    );
  }
}
