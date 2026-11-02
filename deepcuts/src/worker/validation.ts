import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { MAX_AUDIO_BYTES } from "../shared/model";

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
