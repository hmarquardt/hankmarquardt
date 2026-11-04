// Node has no FixedLengthStream. This mirrors the Workers runtime contract used
// by the streaming upload path: the stream errors if the byte count differs.
class FixedLengthStreamPolyfill extends TransformStream<
  Uint8Array,
  Uint8Array
> {
  constructor(expectedLength: number) {
    let written = 0;
    super({
      transform(chunk, controller) {
        written += chunk.byteLength;
        if (written > expectedLength)
          throw new Error("FixedLengthStream: too many bytes written.");
        controller.enqueue(chunk);
      },
      flush() {
        if (written !== expectedLength)
          throw new Error("FixedLengthStream: not enough bytes written.");
      },
    });
  }
}
const globals = globalThis as unknown as Record<string, unknown>;
if (typeof globals.FixedLengthStream === "undefined")
  globals.FixedLengthStream = FixedLengthStreamPolyfill;
