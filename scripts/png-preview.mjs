#!/usr/bin/env node
// @ts-check
/**
 * Print a committed PNG's dimensions and a downscaled ASCII preview.
 *
 * It averages a block of pixels into one character, so it answers only whether a
 * capture is blank or populated and roughly where its content sits. It cannot tell a
 * clipped glyph from an ellipsis; a claim that fine needs an image render or a human.
 *
 * Dependency-free on purpose (`CONTRIBUTING.md`, "Minimal-dependency policy"), so it
 * decodes only the non-interlaced 8-bit colour types a screenshot tool emits. Indexed
 * colour, other bit depths and Adam7 interlacing are refused by name rather than
 * half-decoded, because a preview that silently renders the wrong pixels is worse than
 * no preview. Alpha is composited over white; chunk CRCs are not verified.
 */

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { argv, exit } from "node:process";
import { pathToFileURL } from "node:url";

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Fits an 80-column terminal with margin. */
export const DEFAULT_WIDTH = 72;

export const MIN_WIDTH = 8;

export const MAX_WIDTH = 200;

/** Darkest to lightest, indexed by averaged luminance, so an empty capture looks empty. */
export const RAMP = "@%#*+=-:. ";

const CHANNELS = new Map([
  [0, 1],
  [2, 3],
  [4, 2],
  [6, 4],
]);

const COLOUR_TYPE_NAMES = new Map([
  [0, "greyscale"],
  [2, "truecolour"],
  [3, "indexed-colour"],
  [4, "greyscale with alpha"],
  [6, "truecolour with alpha"],
]);

/**
 * @typedef {{
 *   width: number;
 *   height: number;
 *   bitDepth: number;
 *   colourType: number;
 *   channels: number;
 *   samples: Uint8Array;
 * }} DecodedPng
 * `samples` is `width * height * channels` bytes, row-major, filters already reversed.
 */

/** A refusal a caller is meant to print rather than a bug. */
export class PngError extends Error {
  constructor(message) {
    super(message);
    this.name = "PngError";
  }
}

/**
 * An IDAT split can fall mid-deflate-stream, so the parts are concatenated and
 * inflated as one stream rather than individually.
 *
 * @returns {{ header: Buffer; data: Buffer }}
 */
export function readChunks(file) {
  if (file.length < PNG_SIGNATURE.length || !file.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new PngError("not a PNG: the file does not start with the PNG signature");
  }

  /** @type {Buffer | undefined} */
  let header;
  /** @type {Buffer[]} */
  const parts = [];
  let offset = PNG_SIGNATURE.length;

  while (offset + 8 <= file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("latin1", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > file.length) {
      throw new PngError(`malformed PNG: chunk '${type}' runs past the end of the file`);
    }
    if (type === "IHDR") header = file.subarray(start, end);
    else if (type === "IDAT") parts.push(file.subarray(start, end));
    else if (type === "IEND") break;
    offset = end + 4;
  }

  if (header === undefined) throw new PngError("malformed PNG: no IHDR chunk");
  if (parts.length === 0) throw new PngError("malformed PNG: no IDAT chunk");
  return { header, data: Buffer.concat(parts) };
}

export function readHeader(header) {
  if (header.length < 13) throw new PngError("malformed PNG: IHDR is shorter than 13 bytes");
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const bitDepth = header.readUInt8(8);
  const colourType = header.readUInt8(9);
  const interlace = header.readUInt8(12);

  if (width === 0 || height === 0) {
    throw new PngError(`malformed PNG: zero dimension (${String(width)}x${String(height)})`);
  }
  const channels = CHANNELS.get(colourType);
  if (channels === undefined) {
    const name = COLOUR_TYPE_NAMES.get(colourType) ?? "unknown";
    throw new PngError(
      `unsupported PNG: colour type ${String(colourType)} (${name}); this preview supports 0, 2, 4 and 6`,
    );
  }
  if (bitDepth !== 8) {
    throw new PngError(
      `unsupported PNG: bit depth ${String(bitDepth)}; this preview supports 8-bit samples only`,
    );
  }
  if (interlace !== 0) {
    throw new PngError(
      `unsupported PNG: interlace method ${String(interlace)} (Adam7); this preview supports non-interlaced images only`,
    );
  }
  return { width, height, bitDepth, colourType, channels };
}

/**
 * The Paeth predictor (PNG spec, 9.4): whichever of left, above and upper-left the
 * estimate `a + b - c` lands nearest to, ties going left then above.
 */
export function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Reverse the per-scanline filters (PNG spec, 9.2). `a`, `b` and `c` are the bytes one
 * pixel left, on the previous scanline, and one pixel left on the previous scanline;
 * all three read as zero outside the image.
 */
export function unfilter(raw, { width, height, channels }) {
  const stride = width * channels;
  const expected = (stride + 1) * height;
  // Exactly, not at least. A long payload is the dangerous case: the first `expected`
  // bytes decode cleanly, so a larger image behind a smaller IHDR would print a
  // confident preview of its top-left corner and exit 0.
  if (raw.length !== expected) {
    throw new PngError(
      `malformed PNG: image data is ${String(raw.length)} bytes, expected exactly ${String(expected)}`,
    );
  }

  const out = new Uint8Array(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const from = row * (stride + 1) + 1;
    const to = row * stride;
    const above = to - stride;
    for (let i = 0; i < stride; i += 1) {
      const x = raw[from + i];
      const a = i >= channels ? out[to + i - channels] : 0;
      const b = row > 0 ? out[above + i] : 0;
      const c = row > 0 && i >= channels ? out[above + i - channels] : 0;
      let value;
      if (filter === 0) value = x;
      else if (filter === 1) value = x + a;
      else if (filter === 2) value = x + b;
      else if (filter === 3) value = x + ((a + b) >> 1);
      else if (filter === 4) value = x + paeth(a, b, c);
      else
        throw new PngError(
          `malformed PNG: unknown filter type ${String(filter)} on row ${String(row)}`,
        );
      out[to + i] = value & 0xff;
    }
  }
  return out;
}

export function decodePng(file) {
  const { header, data } = readChunks(file);
  const shape = readHeader(header);
  let raw;
  try {
    raw = inflateSync(data);
  } catch (error) {
    throw new PngError(
      `malformed PNG: image data did not inflate (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  return { ...shape, samples: unfilter(raw, shape) };
}

/**
 * Rec. 709 coefficients rather than a channel mean, which would make blue text read
 * far darker than it looks.
 */
export function luminance(samples, at, channels) {
  const grey = channels < 3;
  const r = samples[at];
  const g = grey ? r : samples[at + 1];
  const b = grey ? r : samples[at + 2];
  const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (channels !== 2 && channels !== 4) return value;
  const alpha = samples[at + (grey ? 1 : 3)] / 255;
  return value * alpha + 255 * (1 - alpha);
}

export function boundWidth(requested) {
  if (!Number.isInteger(requested) || requested < MIN_WIDTH || requested > MAX_WIDTH) {
    throw new PngError(
      `--width must be a whole number between ${String(MIN_WIDTH)} and ${String(MAX_WIDTH)}, got '${String(requested)}'`,
    );
  }
  return requested;
}

/**
 * Rows are halved because a terminal cell is about twice as tall as it is wide, so
 * without it a square image prints as a tall rectangle.
 *
 * @returns {{ columns: number; rows: number; cellWidth: number; cellHeight: number; lines: string[] }}
 */
export function asciiPreview(image, columns) {
  const { width, height, channels, samples } = image;
  const cols = Math.min(columns, width);
  const rows = Math.max(1, Math.round((height * cols) / width / 2));
  const lines = [];

  for (let row = 0; row < rows; row += 1) {
    const y0 = Math.floor((row * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * height) / rows));
    let line = "";
    for (let col = 0; col < cols; col += 1) {
      const x0 = Math.floor((col * width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * width) / cols));
      let total = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          total += luminance(samples, (y * width + x) * channels, channels);
        }
      }
      const mean = total / ((y1 - y0) * (x1 - x0));
      const index = Math.min(RAMP.length - 1, Math.floor((mean / 256) * RAMP.length));
      line += RAMP[index];
    }
    lines.push(line);
  }

  return {
    columns: cols,
    rows,
    cellWidth: width / cols,
    cellHeight: height / rows,
    lines,
  };
}

export function parseArgs(args) {
  /** @type {string | undefined} */
  let file;
  let width = DEFAULT_WIDTH;
  const remaining = [...args];
  while (remaining.length > 0) {
    const arg = /** @type {string} */ (remaining.shift());
    if (arg === "--width") {
      const value = remaining.shift();
      if (value === undefined) throw new PngError("--width requires a value");
      width = boundWidth(Number(value));
    } else if (arg.startsWith("--width=")) {
      width = boundWidth(Number(arg.slice("--width=".length)));
    } else if (arg.startsWith("-")) {
      throw new PngError(`unknown option: ${arg}`);
    } else if (file === undefined) {
      file = arg;
    } else {
      throw new PngError(`unexpected argument: ${arg}`);
    }
  }
  if (file === undefined) {
    throw new PngError("usage: pnpm png:preview <file.png> [--width N]");
  }
  return { file, width };
}

export function main(args) {
  try {
    const { file, width } = parseArgs(args);
    let bytes;
    try {
      bytes = readFileSync(file);
    } catch (error) {
      throw new PngError(
        `cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const image = decodePng(bytes);
    const preview = asciiPreview(image, width);
    const name = COLOUR_TYPE_NAMES.get(image.colourType) ?? "unknown";
    console.log(
      `${file}: ${String(image.width)}x${String(image.height)} px, ` +
        `${String(image.bitDepth)}-bit colour type ${String(image.colourType)} (${name}), non-interlaced`,
    );
    console.log(
      `preview ${String(preview.columns)}x${String(preview.rows)} chars, ` +
        `1 char = ${preview.cellWidth.toFixed(1)}x${preview.cellHeight.toFixed(1)} px, ` +
        `ramp '${RAMP}' dark to light`,
    );
    for (const line of preview.lines) console.log(line);
    return 0;
  } catch (error) {
    console.error(`png-preview: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  exit(main(argv.slice(2)));
}
