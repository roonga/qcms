import { deflateSync } from "node:zlib";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WIDTH,
  MAX_WIDTH,
  MIN_WIDTH,
  PngError,
  RAMP,
  asciiPreview,
  boundWidth,
  decodePng,
  luminance,
  main,
  paeth,
  parseArgs,
} from "./png-preview.mjs";

/**
 * The committed-PNG preview (issue #415).
 *
 * Every fixture here is built in the test rather than committed. A binary fixture is
 * unreadable in a diff and unverifiable in review, and the encoder below is the honest
 * inverse of what the script does: it applies the scanline filters the decoder reverses,
 * so a round-trip through all five filter types is a real assertion about the decoder
 * rather than a re-run of the same code path with the filter byte set to zero.
 */

const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "qcms-png-preview-"));
  temporaryDirectories.push(directory);
  return directory;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One length-type-data-CRC chunk, with a real CRC so the fixtures are genuine PNGs. */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** The Paeth predictor again, on the encoding side, so the round-trip is a real one. */
function paethEncode(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

interface PngSpec {
  width: number;
  height: number;
  colourType: number;
  samples: number[];
  bitDepth?: number;
  interlace?: number;
  /** Filter type applied to every scanline. Defaults to 0 (None). */
  filter?: number;
}

const CHANNELS_FOR: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function encodePng(spec: PngSpec): Buffer {
  const { width, height, colourType, samples } = spec;
  const bitDepth = spec.bitDepth ?? 8;
  const filter = spec.filter ?? 0;
  const channels = CHANNELS_FOR[colourType];
  const stride = width * channels;

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(bitDepth, 8);
  header.writeUInt8(colourType, 9);
  header.writeUInt8(0, 10);
  header.writeUInt8(0, 11);
  header.writeUInt8(spec.interlace ?? 0, 12);

  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = filter;
    for (let i = 0; i < stride; i += 1) {
      const x = samples[row * stride + i];
      const a = i >= channels ? samples[row * stride + i - channels] : 0;
      const b = row > 0 ? samples[(row - 1) * stride + i] : 0;
      const c = row > 0 && i >= channels ? samples[(row - 1) * stride + i - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) predictor = paethEncode(a, b, c);
      raw[row * (stride + 1) + 1 + i] = (x - predictor) & 0xff;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 16x16 truecolour: the left half black, the right half white. */
function halfAndHalf(filter = 0): Buffer {
  const samples: number[] = [];
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const value = x < 8 ? 0 : 255;
      samples.push(value, value, value);
    }
  }
  return encodePng({ width: 16, height: 16, colourType: 2, samples, filter });
}

function fileWith(bytes: Buffer | string, name = "fixture.png"): string {
  const path = join(temporaryDirectory(), name);
  writeFileSync(path, bytes);
  return path;
}

/** Run `main` and capture what it printed, so exit code and output are asserted together. */
function run(args: string[]): { code: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    out.push(String(args[0]));
  });
  const error = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    err.push(String(args[0]));
  });
  try {
    return { code: main(args), out, err };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

describe("decodePng", () => {
  it("reads the dimensions and colour type out of IHDR", () => {
    const image = decodePng(halfAndHalf());
    expect(image.width).toBe(16);
    expect(image.height).toBe(16);
    expect(image.colourType).toBe(2);
    expect(image.bitDepth).toBe(8);
    expect(image.channels).toBe(3);
  });

  it("reverses every scanline filter to the same pixels", () => {
    const none = decodePng(halfAndHalf(0)).samples;
    for (const filter of [1, 2, 3, 4]) {
      expect(
        Array.from(decodePng(halfAndHalf(filter)).samples),
        `filter ${String(filter)}`,
      ).toEqual(Array.from(none));
    }
  });

  it("refuses a file that does not carry the PNG signature", () => {
    expect(() => decodePng(Buffer.from("this is a text file, not a PNG\n", "utf8"))).toThrow(
      /not a PNG/,
    );
  });

  it("refuses indexed colour by name, rather than guessing at a palette", () => {
    // No PLTE chunk: the refusal happens at IHDR, so the palette never comes up.
    const png = encodePng({ width: 2, height: 2, colourType: 3, samples: [0, 1, 1, 0] });
    expect(() => decodePng(png)).toThrow(/colour type 3 \(indexed-colour\)/);
  });

  it("refuses a bit depth it does not decode", () => {
    const png = encodePng({
      width: 1,
      height: 1,
      colourType: 0,
      bitDepth: 16,
      samples: [0, 0],
    });
    expect(() => decodePng(png)).toThrow(/bit depth 16/);
  });

  it("refuses an interlaced image", () => {
    const png = encodePng({
      width: 2,
      height: 2,
      colourType: 0,
      interlace: 1,
      samples: [0, 0, 0, 0],
    });
    expect(() => decodePng(png)).toThrow(/interlace method 1 \(Adam7\)/);
  });

  it("refuses a truncated image data stream instead of previewing partial rows", () => {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(4, 0);
    header.writeUInt32BE(4, 4);
    header.writeUInt8(8, 8);
    header.writeUInt8(0, 9);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(Buffer.alloc(5))),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    expect(() => decodePng(png)).toThrow(PngError);
    expect(() => decodePng(png)).toThrow(/image data is 5 bytes, expected 20/);
  });
});

describe("luminance", () => {
  it("weights green above red above blue, so blue text does not read as black", () => {
    const green = luminance(Uint8Array.from([0, 255, 0]), 0, 3);
    const red = luminance(Uint8Array.from([255, 0, 0]), 0, 3);
    const blue = luminance(Uint8Array.from([0, 0, 255]), 0, 3);
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
  });

  it("composites alpha over white, so a transparent capture reads as blank", () => {
    expect(luminance(Uint8Array.from([0, 0]), 0, 2)).toBe(255);
    expect(luminance(Uint8Array.from([0, 0, 0, 0]), 0, 4)).toBe(255);
    expect(luminance(Uint8Array.from([0, 255]), 0, 2)).toBe(0);
  });
});

describe("asciiPreview", () => {
  it("prints the known pattern: dark on the left, blank on the right", () => {
    const preview = asciiPreview(decodePng(halfAndHalf()), 16);
    expect(preview.columns).toBe(16);
    expect(preview.rows).toBe(8);
    for (const line of preview.lines) expect(line).toBe("@@@@@@@@        ");
  });

  it("halves the row count against the aspect ratio, because a cell is twice as tall", () => {
    const samples = Array.from({ length: 40 * 40 }, () => 0);
    const square = decodePng(encodePng({ width: 40, height: 40, colourType: 0, samples }));
    const preview = asciiPreview(square, 20);
    expect(preview.columns).toBe(20);
    expect(preview.rows).toBe(10);
  });

  it("never asks for more columns than the image has pixels", () => {
    const preview = asciiPreview(decodePng(halfAndHalf()), 100);
    expect(preview.columns).toBe(16);
  });

  it("box-averages, so a checkerboard reads as mid-grey rather than as one extreme", () => {
    const samples: number[] = [];
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) samples.push((x + y) % 2 === 0 ? 0 : 255);
    }
    const preview = asciiPreview(
      decodePng(encodePng({ width: 8, height: 8, colourType: 0, samples })),
      4,
    );
    // Each cell covers 4x2 pixels, half of them black: a mean of 127.5, which lands
    // mid-ramp. A decoder that sampled one pixel per cell would print `@` or a space.
    expect(preview.lines).toEqual([RAMP[4].repeat(4), RAMP[4].repeat(4)]);
  });
});

describe("paeth", () => {
  it("picks the neighbour the linear estimate lands nearest, ties going left", () => {
    expect(paeth(10, 10, 10)).toBe(10);
    expect(paeth(20, 10, 5)).toBe(20);
    expect(paeth(5, 20, 5)).toBe(20);
    expect(paeth(10, 20, 15)).toBe(15);
  });
});

describe("parseArgs", () => {
  it("defaults the width and takes the file positionally", () => {
    expect(parseArgs(["docs/shot.png"])).toEqual({ file: "docs/shot.png", width: DEFAULT_WIDTH });
  });

  it("accepts --width in both spellings", () => {
    expect(parseArgs(["a.png", "--width", "40"]).width).toBe(40);
    expect(parseArgs(["a.png", "--width=40"]).width).toBe(40);
  });

  it("refuses a width outside the bounds a terminal can show", () => {
    expect(() => boundWidth(MIN_WIDTH - 1)).toThrow(/--width must be a whole number/);
    expect(() => boundWidth(MAX_WIDTH + 1)).toThrow(/--width must be a whole number/);
    expect(() => boundWidth(20.5)).toThrow(/--width must be a whole number/);
    expect(() => parseArgs(["a.png", "--width", "wide"])).toThrow(/--width must be/);
  });

  it("refuses an unknown option and a second file", () => {
    expect(() => parseArgs(["a.png", "--zoom"])).toThrow(/unknown option: --zoom/);
    expect(() => parseArgs(["a.png", "b.png"])).toThrow(/unexpected argument: b.png/);
  });

  it("refuses no arguments with the usage line", () => {
    expect(() => parseArgs([])).toThrow(/usage: pnpm png:preview/);
  });
});

describe("main", () => {
  it("prints the dimensions, the scale and the preview, and exits 0", () => {
    const path = fileWith(halfAndHalf());
    const { code, out, err } = run([path, "--width", "16"]);
    expect(err).toEqual([]);
    expect(code).toBe(0);
    expect(out[0]).toContain("16x16 px, 8-bit colour type 2 (truecolour), non-interlaced");
    expect(out[1]).toContain("preview 16x8 chars");
    expect(out.slice(2)).toEqual(Array.from({ length: 8 }, () => "@@@@@@@@        "));
  });

  it("previews greyscale and both alpha colour types", () => {
    const cases: { colourType: number; pixel: number[] }[] = [
      { colourType: 0, pixel: [0] },
      { colourType: 4, pixel: [0, 255] },
      { colourType: 6, pixel: [0, 0, 0, 255] },
    ];
    for (const { colourType, pixel } of cases) {
      const samples = Array.from({ length: 64 }, () => pixel).flat();
      const path = fileWith(encodePng({ width: 8, height: 8, colourType, samples }));
      const { code, out } = run([path, "--width", "8"]);
      expect(code, `colour type ${String(colourType)}`).toBe(0);
      expect(out.slice(2)).toEqual(Array.from({ length: 4 }, () => "@@@@@@@@"));
    }
  });

  it("exits 1 with a named reason on a non-PNG", () => {
    const path = fileWith("not a PNG at all\n", "notes.txt");
    const { code, out, err } = run([path]);
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual(["png-preview: not a PNG: the file does not start with the PNG signature"]);
  });

  it("exits 1 with a named reason on an unsupported colour type", () => {
    const path = fileWith(encodePng({ width: 2, height: 2, colourType: 3, samples: [0, 1, 1, 0] }));
    const { code, err } = run([path]);
    expect(code).toBe(1);
    expect(err[0]).toBe(
      "png-preview: unsupported PNG: colour type 3 (indexed-colour); this preview supports 0, 2, 4 and 6",
    );
  });

  it("exits 1 naming the file it could not read", () => {
    const path = join(temporaryDirectory(), "absent.png");
    const { code, err } = run([path]);
    expect(code).toBe(1);
    expect(err[0]).toContain(`png-preview: cannot read ${path}`);
  });
});
