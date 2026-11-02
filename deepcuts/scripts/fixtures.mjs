// Generated synthetic tones and original procedural artwork. No real recordings,
// purchased albums, private metadata, or downloaded audio enter the repository.
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import installer from "@ffmpeg-installer/ffmpeg";
import sharp from "sharp";

const root = new URL("../fixtures/generated/", import.meta.url);
await mkdir(root, { recursive: true });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="#d8b279"/><stop offset=".5" stop-color="#496956"/><stop offset="1" stop-color="#1c3e3a"/></linearGradient></defs><path fill="url(#a)" d="M0 0h800v800H0z"/><circle cx="380" cy="330" r="220" fill="#c8d5a3" opacity=".5"/><path d="M0 480Q200 290 400 520T800 430V800H0" fill="#173e36"/><path d="M0 590Q300 400 600 670T800 550V800H0" fill="#102e29"/><text x="60" y="95" fill="#f3eed6" font-size="30" font-family="serif">THE QUIET HOURS</text><text x="60" y="735" fill="#d6ddc4" font-size="22" letter-spacing="5" font-family="sans-serif">SYNTHETIC TEST RECORDINGS</text></svg>`;
const cover = new URL("cover.jpg", root).pathname;
await sharp(Buffer.from(svg)).jpeg().toFile(cover);
const names = ["First light", "Slow current", "Last train home"];
const formats = [
  { ext: "mp3", args: ["-c:a", "libmp3lame", "-q:a", "4"] },
  { ext: "m4a", args: ["-c:a", "aac", "-b:a", "96k"] },
  { ext: "flac", args: ["-c:a", "flac"] },
];
for (let i = 0; i < formats.length; i++) {
  const { ext, args } = formats[i];
  // Eight-second soft two-tone textures: long enough to test seek and queue.
  const filename = new URL(
    `${String(i + 1).padStart(2, "0")}-${names[i].toLowerCase().replaceAll(" ", "-")}.${ext}`,
    root,
  ).pathname;
  const command = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${220 + i * 110}:sample_rate=44100:duration=8`,
    "-i",
    cover,
    "-map",
    "0:a",
    "-map",
    "1:v",
    "-c:v",
    "copy",
    "-disposition:v",
    "attached_pic",
    ...args,
    "-metadata",
    "album=The Quiet Hours",
    "-metadata",
    "artist=Deep Cuts Test Ensemble",
    "-metadata",
    "album_artist=Deep Cuts Test Ensemble",
    "-metadata",
    `title=${names[i]}`,
    "-metadata",
    `track=${i + 1}`,
    "-metadata",
    "date=2026",
    ...(ext === "mp3" ? ["-id3v2_version", "3"] : []),
    filename,
  ];
  const result = spawnSync(installer.path, command, { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`Fixture encoding failed: ${result.stderr.slice(-1500)}`);
}
await writeFile(
  new URL("README.txt", root),
  "Generated sine tones, original procedural cover, fictional test tags. Not music from a real artist. Regenerate with npm run fixtures.\n",
);
console.log(
  "Generated a three-track synthetic album in fixtures/generated (MP3, AAC/M4A, FLAC).",
);
