import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MAX_AUDIO_BYTES, formatBytes, sha256 } from "../../src/shared/model";
import {
  contentLength,
  fixedLengthStream,
  importSchema,
  verifyAudioStream,
} from "../../src/worker/validation";
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

/** A synthetic file that starts like a valid MP3 and carries arbitrary bytes. */
function audioFile(bytes: number, fill = 7): Uint8Array {
  const data = new Uint8Array(bytes);
  data.set(new TextEncoder().encode("ID3"));
  data.fill(fill, 3);
  return data;
}

function expectations(bytes: Uint8Array, mime = "audio/mpeg") {
  return { bytes: bytes.byteLength, sha256: digest(bytes), mime };
}

async function beginImport(
  ctx: Context,
  declaredBytes: Uint8Array,
  declaredSha = digest(declaredBytes),
) {
  const cookie = await authenticate(ctx);
  const headers = {
    Cookie: cookie,
    Origin: origin,
    "Content-Type": "application/json",
  };
  const created = await ctx.request("/api/imports", {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "Large-format album",
      artist: "Test ensemble",
      year: 2026,
      tracks: [
        {
          title: "Long player",
          artist: "Test ensemble",
          track_number: 1,
          disc_number: 1,
          duration: 640,
          filename: "01-long-player.mp3",
          mime: "audio/mpeg",
          bytes: declaredBytes.byteLength,
          sha256: declaredSha,
        },
      ],
    }),
  });
  expect(created.status).toBe(201);
  const result = (await created.json()) as {
    id: string;
    tracks: { id: string }[];
  };
  const trackId = result.tracks[0].id;
  return {
    cookie,
    headers,
    importId: result.id,
    trackId,
    path: `/api/imports/${result.id}/tracks/${trackId}`,
    upload(
      body: Uint8Array | ReadableStream<Uint8Array>,
      length = declaredBytes.byteLength,
    ) {
      return ctx.request(`/api/imports/${result.id}/tracks/${trackId}`, {
        method: "PUT",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "Content-Length": String(length),
        },
        body: body as BodyInit,
        duplex: "half",
      } as unknown as RequestInit);
    },
    complete() {
      return ctx.request(`/api/imports/${result.id}/complete`, {
        method: "POST",
        headers,
      });
    },
    media() {
      return ctx.request(`/api/tracks/${trackId}/audio`, { headers });
    },
  };
}

async function runVerifier(
  chunks: Uint8Array[],
  expected: { bytes: number; sha256: string; mime: string },
) {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const verified = verifyAudioStream(source, expected);
  const fixed = fixedLengthStream(expected.bytes);
  const pump = verified.body.pipeTo(fixed.writable).catch(() => undefined);
  let output: Uint8Array | null = null;
  try {
    output = new Uint8Array(await new Response(fixed.readable).arrayBuffer());
  } catch {
    output = null;
  }
  await pump;
  return { output, failure: verified.failure() };
}
describe("audio size limits", () => {
  it("raises the per-track ceiling to at least 64 MiB in whole MiB units", () => {
    expect(MAX_AUDIO_BYTES).toBeGreaterThanOrEqual(64 * 1024 * 1024);
    expect(MAX_AUDIO_BYTES % (1024 * 1024)).toBe(0);
    expect(formatBytes(MAX_AUDIO_BYTES)).toBe("64.0 MB");
  });
  it("accepts a manifest exactly at the limit and rejects one byte more", () => {
    const manifest = (bytes: number) => ({
      title: "Album",
      artist: "Artist",
      year: null,
      tracks: [
        {
          title: "Boundary",
          artist: "Test ensemble",
          track_number: 1,
          disc_number: 1,
          duration: 10,
          filename: "01-boundary.mp3",
          mime: "audio/mpeg",
          bytes,
          sha256: "a".repeat(64),
        },
      ],
    });
    expect(importSchema.safeParse(manifest(MAX_AUDIO_BYTES)).success).toBe(
      true,
    );
    expect(importSchema.safeParse(manifest(MAX_AUDIO_BYTES + 1)).success).toBe(
      false,
    );
    expect(importSchema.safeParse(manifest(0)).success).toBe(false);
  });
  it("parses only positive whole Content-Length values", () => {
    expect(contentLength("1024")).toBe(1024);
    expect(contentLength(" 1024 ")).toBe(1024);
    for (const value of [
      null,
      "",
      "0",
      "-1",
      "1.5",
      "1e3",
      "abc",
      "1234567890123",
    ])
      expect(contentLength(value)).toBeNull();
  });
});

describe("streaming audio verification", () => {
  it("passes exact bytes through unchanged", async () => {
    const data = audioFile(4096);
    const { output, failure } = await runVerifier([data], expectations(data));
    expect(failure).toBeNull();
    expect(output).toEqual(data);
  });
  it("validates a signature split across tiny chunks", async () => {
    const data = audioFile(64);
    const chunks = [...data].map((byte) => new Uint8Array([byte]));
    const { output, failure } = await runVerifier(chunks, expectations(data));
    expect(failure).toBeNull();
    expect(output).toEqual(data);
  });
  it("rejects a body shorter than declared", async () => {
    const data = audioFile(100);
    const { failure } = await runVerifier(
      [data.subarray(0, 99)],
      expectations(data),
    );
    expect(failure).toMatchObject({ status: 422 });
  });
  it("rejects a body longer than declared", async () => {
    const data = audioFile(100);
    const { failure } = await runVerifier(
      [data, new Uint8Array([1])],
      expectations(data),
    );
    expect(failure).toMatchObject({ status: 413 });
  });
  it("rejects a digest mismatch", async () => {
    const data = audioFile(512);
    const { output, failure } = await runVerifier([data], {
      ...expectations(data),
      sha256: "b".repeat(64),
    });
    expect(failure).toMatchObject({ status: 422 });
    expect(output).toBeNull();
  });
  it("rejects non-audio contents before the upload finishes", async () => {
    const junk = new TextEncoder().encode("<html>not music at all</html>");
    const { failure } = await runVerifier([junk], expectations(junk));
    expect(failure).toMatchObject({ status: 415 });
  });
});

describe("streamed original uploads", () => {
  it("accepts a 38 MiB track without buffering it in the Worker", async () => {
    const ctx = environment();
    const data = audioFile(38 * 1024 * 1024);
    const session = await beginImport(ctx, data);
    const response = await session.upload(data);
    expect(response.status).toBe(200);
    const stored = [...ctx.objects.entries()];
    expect(stored).toHaveLength(1);
    expect(stored[0][1].streamed).toBe(true);
    expect(stored[0][1].bytes.byteLength).toBe(data.byteLength);
    expect(stored[0][1].options.customMetadata?.sha256).toBe(digest(data));
    expect((await session.complete()).status).toBe(200);
    const library = (await (
      await ctx.request("/api/library", { headers: session.headers })
    ).json()) as { albums: { tracks: { bytes: number }[] }[] };
    expect(library.albums[0].tracks[0].bytes).toBe(data.byteLength);
    const media = await session.media();
    expect(media.status).toBe(200);
    expect(media.headers.get("Content-Length")).toBe(String(data.byteLength));
    const downloaded = new Uint8Array(await media.arrayBuffer());
    expect(downloaded.byteLength).toBe(data.byteLength);
    expect(await sha256(downloaded.buffer as ArrayBuffer)).toBe(digest(data));
  }, 60000);

  it("requires an exact Content-Length and rejects oversized declarations", async () => {
    const ctx = environment();
    const data = audioFile(2048);
    const session = await beginImport(ctx, data);
    const withoutLength = await ctx.request(session.path, {
      method: "PUT",
      headers: { Cookie: session.cookie, Origin: origin },
      body: data as unknown as BodyInit,
    });
    expect(withoutLength.status).toBe(411);
    const oversized = await session.upload(
      new Uint8Array(MAX_AUDIO_BYTES + 1).fill(1),
      MAX_AUDIO_BYTES + 1,
    );
    expect(oversized.status).toBe(413);
    const wrongSize = await session.upload(data, data.byteLength + 1);
    expect(wrongSize.status).toBe(422);
    expect(ctx.objects.size).toBe(0);
  }, 30000);

  it("keeps a mismatched file out of storage, then accepts the original", async () => {
    const ctx = environment();
    const original = audioFile(4096, 1);
    const impostor = audioFile(4096, 2);
    const session = await beginImport(ctx, original);
    const rejected = await session.upload(impostor);
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toMatchObject({
      error: expect.stringContaining("integrity"),
    });
    expect(ctx.objects.size).toBe(0);
    expect((await session.complete()).status).toBe(409);
    expect((await session.upload(original)).status).toBe(200);
    expect((await session.complete()).status).toBe(200);
  });

  it("reports an interrupted upload and allows a clean retry", async () => {
    const ctx = environment();
    const data = audioFile(64 * 1024);
    const session = await beginImport(ctx, data);
    const interrupted = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data.subarray(0, 1024));
        controller.error(new Error("connection lost"));
      },
    });
    const failed = await session.upload(interrupted);
    expect([422, 502]).toContain(failed.status);
    expect(ctx.objects.size).toBe(0);
    expect((await session.upload(data)).status).toBe(200);
    expect(ctx.objects.size).toBe(1);
  });

  it("rejects non-audio bytes even when the digest matches", async () => {
    const ctx = environment();
    const junk = new TextEncoder().encode(
      "<html>this is not an audio container</html>",
    );
    const session = await beginImport(ctx, junk);
    const response = await session.upload(junk);
    expect(response.status).toBe(415);
    expect(ctx.objects.size).toBe(0);
  });

  it("never overwrites a stored original, even on a retry", async () => {
    const ctx = environment();
    const data = audioFile(8192, 3);
    const session = await beginImport(ctx, data);
    const key = `imports/${session.importId}/${session.trackId}`;
    // Something else already occupies the object key.
    ctx.objects.set(key, {
      bytes: new Uint8Array([1, 2, 3]),
      options: { customMetadata: { sha256: "c".repeat(64) } },
      streamed: false,
    });
    const conflict = await session.upload(data);
    expect(conflict.status).toBe(409);
    expect(ctx.objects.get(key)?.bytes.byteLength).toBe(3);
    // A retry with a different file after a good upload is rejected, and the
    // stored original is untouched.
    ctx.objects.clear();
    expect((await session.upload(data)).status).toBe(200);
    const wrong = await session.upload(audioFile(8192, 4));
    expect(wrong.status).toBe(422);
    const stored = ctx.objects.get(key);
    expect(stored?.bytes.byteLength).toBe(data.byteLength);
    expect(stored?.options.customMetadata?.sha256).toBe(digest(data));
  });
});
