import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { createHash } from "node:crypto";
import { MAX_AUDIO_BYTES, MAX_PLAYLIST_TRACKS } from "../shared/model";

const text = z.string().trim().min(1).max(300);
export const importSchema = z
  .object({
    title: text,
    artist: text,
    year: z.number().int().min(1000).max(9999).nullable(),
    tracks: z
      .array(
        z
          .object({
            title: text,
            artist: text,
            track_number: z.number().int().min(1).max(9999),
            disc_number: z.number().int().min(1).max(999),
            duration: z.number().finite().positive().max(86400),
            filename: z
              .string()
              .min(1)
              .max(255)
              .refine((v) => !/[\x00-\x1f/\\]/.test(v)),
            mime: z.enum([
              "audio/mpeg",
              "audio/mp4",
              "audio/aac",
              "audio/flac",
            ]),
            bytes: z.number().int().min(1).max(MAX_AUDIO_BYTES),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const stateSchema = z
  .object({
    queue: z.array(z.string().uuid()).max(1000),
    current: z.string().uuid().nullable(),
    position: z.number().finite().min(0).max(86400),
    queue_index: z.number().int().min(0).max(999).optional(),
  })
  .strict();
export const playlistTitle = z.string().trim().min(1).max(120);
export const playlistCreateSchema = z.object({ title: playlistTitle }).strict();
export const playlistRenameSchema = z.object({ title: playlistTitle }).strict();
export const playlistTrackSchema = z
  .object({ track_id: z.string().uuid() })
  .strict();
export const playlistOrderSchema = z
  .object({
    track_ids: z
      .array(z.string().uuid())
      .max(MAX_PLAYLIST_TRACKS)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "A track can only appear once in a playlist.",
      }),
  })
  .strict();

export async function boundedBody(
  request: Request,
  limit: number,
): Promise<ArrayBuffer> {
  const length = Number(request.headers.get("Content-Length"));
  if (length > limit)
    throw new HTTPException(413, {
      message: "This file exceeds the MVP upload limit.",
    });
  if (!request.body)
    throw new HTTPException(400, { message: "A request body is required." });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new HTTPException(413, {
        message: "This file exceeds the MVP upload limit.",
      });
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return buffer.buffer;
}
export async function jsonBody(
  request: Request,
  limit = 128 * 1024,
): Promise<unknown> {
  if (
    request.headers.get("Content-Type")?.split(";")[0] !== "application/json"
  ) {
    throw new HTTPException(415, { message: "Expected JSON." });
  }
  try {
    return JSON.parse(
      new TextDecoder().decode(await boundedBody(request, limit)),
    );
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(400, { message: "Invalid JSON." });
  }
}
export function audioSignature(data: ArrayBuffer, mime: string): boolean {
  const b = new Uint8Array(data);
  const ascii = (start: number, count: number) =>
    new TextDecoder().decode(b.slice(start, start + count));
  if (b.length < 12) return false;
  if (mime === "audio/flac") return ascii(0, 4) === "fLaC";
  if (mime === "audio/mp4") return ascii(4, 4) === "ftyp";
  if (mime === "audio/mpeg" || mime === "audio/aac")
    return ascii(0, 3) === "ID3" || (b[0] === 255 && (b[1] & 224) === 224);
  return false;
}
export function artworkMime(data: ArrayBuffer): string | null {
  const b = new Uint8Array(data);
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v))
    return "image/png";
  return null;
}

/** Strict Content-Length parsing. Null means missing, chunked, or malformed. */
export function contentLength(header: string | null): number | null {
  const value = header?.trim() ?? "";
  if (!/^\d{1,12}$/.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) && length > 0 ? length : null;
}

export class AudioVerificationError extends Error {
  constructor(
    readonly status: 413 | 415 | 422,
    message: string,
  ) {
    super(message);
    this.name = "AudioVerificationError";
  }
}

const AUDIO_HEADER_BYTES = 12;

export interface AudioExpectation {
  bytes: number;
  sha256: string;
  mime: string;
}

/**
 * Streams an upload through a bounded, verifying transform.
 *
 * The body is hashed incrementally with node:crypto and never buffered whole, so
 * memory stays flat regardless of track size. A size, digest or container
 * mismatch errors the stream before R2 can commit it. The returned stream must be
 * piped into a fixed-length stream so R2 receives an exact Content-Length.
 */
export function verifyAudioStream(
  source: ReadableStream<Uint8Array>,
  expected: AudioExpectation,
): {
  body: ReadableStream<Uint8Array>;
  failure: () => AudioVerificationError | null;
  received: () => number;
} {
  let failure: AudioVerificationError | null = null;
  let received = 0;
  let checkedSignature = false;
  const head = new Uint8Array(AUDIO_HEADER_BYTES);
  let headBytes = 0;
  const hash = createHash("sha256");
  const fail = (
    controller: TransformStreamDefaultController<Uint8Array>,
    error: AudioVerificationError,
  ) => {
    failure ??= error;
    controller.error(error);
  };
  const checkSignature = (
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => {
    if (checkedSignature || headBytes < AUDIO_HEADER_BYTES) return;
    checkedSignature = true;
    if (!audioSignature(head.buffer as ArrayBuffer, expected.mime))
      fail(
        controller,
        new AudioVerificationError(415, "Unsupported audio file contents."),
      );
  };
  const body = source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (failure) return;
        received += chunk.byteLength;
        if (received > expected.bytes) {
          fail(
            controller,
            new AudioVerificationError(
              413,
              "This file is larger than the size recorded for the import.",
            ),
          );
          return;
        }
        if (headBytes < AUDIO_HEADER_BYTES) {
          const take = Math.min(
            AUDIO_HEADER_BYTES - headBytes,
            chunk.byteLength,
          );
          head.set(chunk.subarray(0, take), headBytes);
          headBytes += take;
          checkSignature(controller);
          if (failure) return;
        }
        hash.update(chunk);
        controller.enqueue(chunk);
      },
      flush(controller) {
        if (failure) return;
        if (received !== expected.bytes) {
          fail(
            controller,
            new AudioVerificationError(
              422,
              "The upload ended before the whole file arrived. Choose the original file again.",
            ),
          );
          return;
        }
        if (hash.digest("hex") !== expected.sha256) {
          fail(
            controller,
            new AudioVerificationError(
              422,
              "File integrity check failed. Choose the original file again.",
            ),
          );
          return;
        }
        if (!checkedSignature) {
          checkedSignature = true;
          if (!audioSignature(head.buffer as ArrayBuffer, expected.mime))
            fail(
              controller,
              new AudioVerificationError(
                415,
                "Unsupported audio file contents.",
              ),
            );
        }
      },
    }),
  );
  return { body, failure: () => failure, received: () => received };
}

/**
 * A fixed-length transform is what lets R2 record the exact object length while
 * the Worker streams the body. The polyfill in the Node test setup mirrors the
 * Workers runtime behaviour closely enough for the verification tests.
 */
export function fixedLengthStream(
  length: number,
): TransformStream<Uint8Array, Uint8Array> {
  return new FixedLengthStream(length) as unknown as TransformStream<
    Uint8Array,
    Uint8Array
  >;
}
