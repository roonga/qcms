import { inflateSync } from "node:zlib";

import jpeg from "jpeg-js";
import pngjs from "pngjs";
import { describe, expect, it } from "vitest";

import {
  IEND,
  PNG_SIGNATURE,
  craftPng,
  idatChunk,
  ihdrChunk,
  pngChunk,
  withIhdr,
} from "../../../../e2e/support/png-fixtures.js";
import { createLogoCodec } from "./node-codec.js";
import type { BoundedInflate } from "./node-codec.js";
import { LOGO_MAX_PIXELS } from "./logo-dimensions.js";
import { LogoRefused } from "./port.js";
import type { LogoRefusalReason } from "./port.js";

const codec = createLogoCodec();

function png(width: number, height: number, fill: (index: number) => number): Buffer {
  const image = new pngjs.PNG({ width, height });
  for (let index = 0; index < image.data.length; index += 1) image.data[index] = fill(index);
  return pngjs.PNG.sync.write(image);
}

const SOLID = png(8, 4, (index) => (index % 4 === 3 ? 255 : 0x40));

/** A lossless 1x1 WebP. */
const WEBP_1X1 = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");

async function refusal(
  bytes: Uint8Array,
  using = codec,
): Promise<{ readonly reason: LogoRefusalReason; readonly ms: number }> {
  const started = performance.now();
  const outcome = await using.reencode(bytes).then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(outcome).toBeInstanceOf(LogoRefused);
  return { reason: (outcome as LogoRefused).reason, ms: performance.now() - started };
}

async function refusedWith(bytes: Uint8Array, reason: LogoRefusalReason): Promise<void> {
  expect((await refusal(bytes)).reason).toBe(reason);
}

/** A codec whose pre-inflate is observed: the bound it was given, and how it ended. */
function observedCodec(): {
  readonly codec: ReturnType<typeof createLogoCodec>;
  readonly calls: { maxOutputLength: number; outcome: "ok" | "over-bound" }[];
} {
  const calls: { maxOutputLength: number; outcome: "ok" | "over-bound" }[] = [];
  const inflate: BoundedInflate = (data, options) => {
    try {
      const out = inflateSync(data, options);
      calls.push({ maxOutputLength: options.maxOutputLength, outcome: "ok" });
      return out;
    } catch (err: unknown) {
      calls.push({ maxOutputLength: options.maxOutputLength, outcome: "over-bound" });
      throw err;
    }
  };
  return { codec: createLogoCodec({ inflate }), calls };
}

function isPng(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 8)).equals(PNG_SIGNATURE);
}

describe("SEC-18 F7: a logo is decoded, held to the pixel cap and re-encoded", () => {
  it("re-encodes a PNG as PNG with the same pixels", async () => {
    const out = await codec.reencode(SOLID);
    expect(out.contentType).toBe("image/png");
    expect([out.width, out.height]).toStrictEqual([8, 4]);
    const decoded = pngjs.PNG.sync.read(Buffer.from(out.bytes));
    expect(Buffer.from(decoded.data).equals(pngjs.PNG.sync.read(SOLID).data)).toBe(true);
  });

  it("drops a text chunk and refuses a trailing payload", async () => {
    const withText = Buffer.concat([
      SOLID.subarray(0, 33),
      pngChunk("tEXt", Buffer.from("Comment\0hello")),
      SOLID.subarray(33),
    ]);
    const stripped = Buffer.from((await codec.reencode(withText)).bytes);
    expect(stripped.includes(Buffer.from("tEXt"))).toBe(false);
    expect(stripped.includes(Buffer.from("hello"))).toBe(false);

    const payload = Buffer.from("<script>alert(1)</script>");
    await refusedWith(Buffer.concat([SOLID, payload]), "not-raster");
  });

  it("re-encodes a JPEG as PNG, and refuses a WebP as unsupported", async () => {
    const jpegBytes = jpeg.encode(
      { width: 6, height: 3, data: Buffer.alloc(6 * 3 * 4, 0x80) },
      90,
    ).data;
    const out = await codec.reencode(jpegBytes);
    expect(out.contentType).toBe("image/png");
    expect(isPng(out.bytes)).toBe(true);
    expect([out.width, out.height]).toStrictEqual([6, 3]);

    await refusedWith(WEBP_1X1, "unsupported");
  });

  it("refuses an SVG and a polyglot that leads with a PNG signature", async () => {
    await refusedWith(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "not-raster");
    const polyglot = Buffer.concat([SOLID.subarray(0, 8), Buffer.from("<html><script>")]);
    await refusedWith(polyglot, "not-raster");
  });

  it("refuses over the pixel cap from the header alone, before decoding", async () => {
    const observed = observedCodec();
    for (const [width, height] of [
      [5000, 10],
      [3000, 3000],
    ] as const) {
      expect((await refusal(withIhdr(SOLID, width, height), observed.codec)).reason).toBe(
        "too-many-pixels",
      );
    }
    expect(observed.calls).toStrictEqual([]);

    const jpegBytes = Buffer.from(
      jpeg.encode({ width: 4, height: 4, data: Buffer.alloc(64, 0x80) }, 90).data,
    );
    const sof = jpegBytes.indexOf(Buffer.from([0xff, 0xc0]));
    jpegBytes.writeUInt16BE(6000, sof + 5);
    jpegBytes.writeUInt16BE(6000, sof + 7);
    await refusedWith(jpegBytes, "too-many-pixels");
  });

  it("refuses a header that disagrees with the pixels, and an interlaced PNG as unsupported", async () => {
    await refusedWith(withIhdr(SOLID, 9, 4), "not-raster");
    await refusedWith(withIhdr(SOLID, 8, 4, 1), "unsupported");
  });

  it("refuses a wrong IHDR CRC, an IHDR that is not first, and a second IHDR", async () => {
    const badCrc = Buffer.from(SOLID);
    badCrc[29] = badCrc[29]! ^ 0xff;
    await refusedWith(badCrc, "not-raster");

    const idat = idatChunk(Buffer.alloc((8 * 4 + 1) * 4));
    await refusedWith(
      craftPng([pngChunk("tEXt", Buffer.from("a\0b")), ihdrChunk(8, 4), idat, IEND]),
      "not-raster",
    );
    await refusedWith(craftPng([ihdrChunk(8, 4), ihdrChunk(8, 4), idat, IEND]), "not-raster");
  });

  it("refuses a second IHDR at 22000x22000 before any inflate, in well under a second", async () => {
    const observed = observedCodec();
    const raw = Buffer.alloc(22_001 * 64);
    const doubled = craftPng([
      ihdrChunk(1, 1, { colorType: 0 }),
      ihdrChunk(22_000, 22_000, { colorType: 0 }),
      idatChunk(raw),
      IEND,
    ]);
    const refused = await refusal(doubled, observed.codec);
    expect(refused.reason).toBe("not-raster");
    expect(refused.ms).toBeLessThan(500);
    expect(observed.calls).toStrictEqual([]);
  });

  it("refuses a second IHDR that sets interlace before any inflate", async () => {
    const observed = observedCodec();
    const doubled = craftPng([
      ihdrChunk(1, 1, { colorType: 0 }),
      ihdrChunk(8, 8, { colorType: 0, interlace: 1 }),
      idatChunk(Buffer.alloc(16 * 1024 * 1024)),
      IEND,
    ]);
    expect((await refusal(doubled, observed.codec)).reason).toBe("not-raster");
    expect(observed.calls).toStrictEqual([]);
  });

  it("inflates image data against the exact size the header allows, and stops a bomb at that bound", async () => {
    const observed = observedCodec();
    await observed.codec.reencode(SOLID);
    // Eight RGBA pixels and one filter byte per row, four rows.
    expect(observed.calls).toStrictEqual([{ maxOutputLength: (8 * 4 + 1) * 4, outcome: "ok" }]);

    const bomb = craftPng([ihdrChunk(8, 4), idatChunk(Buffer.alloc(32 * 1024 * 1024)), IEND]);
    const bombed = observedCodec();
    expect((await refusal(bomb, bombed.codec)).reason).toBe("not-raster");
    expect(bombed.calls).toStrictEqual([{ maxOutputLength: 132, outcome: "over-bound" }]);
  });

  it("decodes a JPEG exactly at the pixel cap, and refuses one a row past it", async () => {
    const side = Math.sqrt(LOGO_MAX_PIXELS);
    const atCap = Buffer.from(
      jpeg.encode({ width: side, height: side, data: Buffer.alloc(side * side * 4, 0x80) }, 50)
        .data,
    );
    const out = await codec.reencode(atCap);
    expect([out.width, out.height]).toStrictEqual([side, side]);

    const sof = atCap.indexOf(Buffer.from([0xff, 0xc0]));
    const past = Buffer.from(atCap);
    past.writeUInt16BE(side + 1, sof + 5);
    await refusedWith(past, "too-many-pixels");
  }, 60_000);

  it("refuses a JPEG frame with a component count no logo has", async () => {
    const bytes = Buffer.from(
      jpeg.encode({ width: 4, height: 4, data: Buffer.alloc(64, 0x80) }, 90).data,
    );
    bytes[bytes.indexOf(Buffer.from([0xff, 0xc0])) + 9] = 200;
    await refusedWith(bytes, "not-raster");
  });

  it("refuses a logo whose re-encoding is over the byte cap", async () => {
    let seed = 7;
    const noise = png(1024, 1024, () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed >>> 16;
    });
    await refusedWith(noise, "too-large");
  });
});
