#!/usr/bin/env node
// @ts-check
/**
 * Print a committed PNG's dimensions and a downscaled ASCII preview (issue #415).
 *
 * The rule that came out of task 057 is that gate prose describing a rendering is
 * written from the rendering, not from the intent: in that case the word "ellipsizing"
 * travelled through a PR body, a gate README, a review comment and a relay to the Code
 * Owner while the column was actually hard-clipping mid-glyph. Four hands, and nobody
 * had opened the file.
 *
 * An agent's Read tool renders a PNG directly, and that is the better look every time it
 * is available. This script is the fallback for a terminal-only lane, and it answers a
 * coarser question than the Read tool does: whether a capture is blank or populated,
 * whether the dark band is where a claim says it is, whether a region has content in it
 * at all, and whether the theme is light or dark. It works at the scale of a block of
 * pixels averaged into one character, so it cannot tell a clipped glyph from an
 * ellipsis, which was 057's own question. A claim that fine still needs the Read tool or
 * a human; what this removes is the case where nobody looked at all.
 *
 * Dependency-free on purpose (`CONTRIBUTING.md`, "Minimal-dependency policy"). The
 * repository has no PIL, no ImageMagick, and `playwright` resolves only through
 * `pnpm exec`, so every previous attempt at this built a throwaway harness inside a
 * scratchpad that did not survive the session. Node's own `node:zlib` is the only thing
 * a PNG decoder actually needs.
 *
 * Scope, and why it stops where it does. Non-interlaced 8-bit PNGs in colour types 0
 * (greyscale), 2 (truecolour), 4 (greyscale + alpha) and 6 (truecolour + alpha) are what
 * Playwright, Chrome and every screenshot tool in this repository emit, so they are what
 * this decodes. Indexed colour, 1/2/4/16-bit depths and Adam7 interlacing are refused by
 * name rather than half-decoded, because a preview that silently renders the wrong
 * pixels is worse than no preview: it would reintroduce exactly the confident-and-wrong
 * gate prose the tool exists to prevent.
 *
 * Alpha is composited over white, matching how a screenshot with a transparent
 * background is read on a page. Chunk CRCs are not verified: this reports what a decoder
 * sees, and a corrupt file fails at the inflate or the scanline length instead.
 *
 * Usage:
 *   pnpm png:preview <file.png>
 *   pnpm png:preview <file.png> --width 100
 *   node scripts/png-preview.mjs <file.png> [--width N]
 *
 * Exit codes: 0 on a printed preview, 1 with `png-preview: <reason>` on stderr for a
 * missing file, a non-PNG, an unsupported PNG, or a malformed one.
 */

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { argv, exit } from "node:process";
import { pathToFileURL } from "node:url";

/** The eight bytes every PNG starts with (PNG spec, 5.2). */
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Preview width when `--width` is not given: fits an 80-column terminal with margin. */
export const DEFAULT_WIDTH = 72;

/** Narrowest preview worth printing. Below this the shapes stop being readable. */
export const MIN_WIDTH = 8;

/** Widest preview. Past this the preview wraps in any normal terminal and reads worse. */
export const MAX_WIDTH = 200;

/**
 * Darkest to lightest. Index by the averaged luminance, so a black pixel prints `@` and
 * a white one prints a space, which is what makes an empty capture look empty.
 */
export const RAMP = "@%#*+=-:. ";

/** Samples per pixel for each colour type this decoder supports. */
const CHANNELS = new Map([
  [0, 1],
  [2, 3],
  [4, 2],
  [6, 4],
]);

/** Human names for every colour type the PNG spec defines, including the refused ones. */
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

/**
 * A refusal a caller is meant to print rather than a bug. Every message names the
 * reason, because "could not preview that" sends a reader back to guessing.
 */
export class PngError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "PngError";
  }
}

/**
 * Walk the chunk sequence once, collecting the header and the compressed image data.
 *
 * IDAT is allowed to be split across any number of chunks and the split can fall
 * mid-deflate-stream, so the parts are concatenated and inflated as one stream rather
 * than inflated individually.
 *
 * @param {Buffer} file
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

/**
 * Parse IHDR and refuse anything this decoder would have to guess at.
 *
 * @param {Buffer} header
 * @returns {{ width: number; height: number; bitDepth: number; colourType: number; channels: number }}
 */
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
 * The Paeth predictor (PNG spec, 9.4): pick whichever of left, above and upper-left the
 * linear estimate `a + b - c` lands nearest to, ties going left then above.
 *
 * @param {number} a left
 * @param {number} b above
 * @param {number} c upper-left
 * @returns {number}
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
 * Reverse the per-scanline filters (PNG spec, 9.2) into raw samples.
 *
 * Each scanline arrives as one filter-type byte followed by `width * channels` bytes.
 * Filters reference the byte one pixel to the left (`a`), the same byte on the previous
 * scanline (`b`) and the byte one pixel left on the previous scanline (`c`); all three
 * read as zero outside the image.
 *
 * @param {Buffer} raw inflated image data
 * @param {{ width: number; height: number; channels: number }} shape
 * @returns {Uint8Array}
 */
export function unfilter(raw, { width, height, channels }) {
  const stride = width * channels;
  const expected = (stride + 1) * height;
  // Exactly, not at least. A non-interlaced stream is fully determined by IHDR, so any
  // other length means the header and the payload disagree about the image, and this
  // script's whole posture is to refuse rather than preview pixels it had to guess at.
  // Short is a truncated file. Long is the dangerous one: the first `expected` bytes
  // decode cleanly, so a payload holding a 4x4 image behind a 2x2 IHDR would print a
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

/**
 * Decode a PNG file into raw 8-bit samples.
 *
 * @param {Buffer} file
 * @returns {DecodedPng}
 */
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
 * One pixel's luminance, 0 (black) to 255 (white), alpha composited over white.
 *
 * Rec. 709 coefficients, which is what "how bright does this look" means for sRGB
 * screenshots: green dominates and blue barely registers, so a plain channel mean would
 * make blue text read far darker than it looks.
 *
 * @param {Uint8Array} samples
 * @param {number} at index of the pixel's first sample
 * @param {number} channels
 * @returns {number}
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

/**
 * Bound a requested preview width to something a terminal can show.
 *
 * @param {number} requested
 * @returns {number}
 */
export function boundWidth(requested) {
  if (!Number.isInteger(requested) || requested < MIN_WIDTH || requested > MAX_WIDTH) {
    throw new PngError(
      `--width must be a whole number between ${String(MIN_WIDTH)} and ${String(MAX_WIDTH)}, got '${String(requested)}'`,
    );
  }
  return requested;
}

/**
 * Downscale to an ASCII grid by box-averaging luminance.
 *
 * Rows are halved against the aspect ratio because a terminal cell is about twice as
 * tall as it is wide; without that a square image prints as a tall rectangle and every
 * judgement about proportion made from the preview is wrong.
 *
 * @param {DecodedPng} image
 * @param {number} columns
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

/**
 * @param {string[]} args
 * @returns {{ file: string; width: number }}
 */
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

/**
 * @param {string[]} args
 * @returns {number} process exit code
 */
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
