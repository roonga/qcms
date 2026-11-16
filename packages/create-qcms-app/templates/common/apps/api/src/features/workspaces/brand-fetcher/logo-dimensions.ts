import type { RasterLogoContentType } from "@roonga/qcms-core";

export const LOGO_MAX_PIXELS = 4_194_304;
export const LOGO_MAX_SIDE = 4_096;

export interface LogoDimensions {
  readonly width: number;
  readonly height: number;
}

function u16be(bytes: Uint8Array, at: number): number {
  return (bytes[at]! << 8) | bytes[at + 1]!;
}

function u32be(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!
  );
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCodePoint(...bytes.subarray(at, at + length));
}

/** An interlaced PNG is refused: the decoder inflates it with no bound on the output. */
function pngDimensions(bytes: Uint8Array): LogoDimensions | null {
  if (bytes.length < 33 || u32be(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") return null;
  if (bytes[28] !== 0) return null;
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

const JPEG_STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8]);
const JPEG_NOT_FRAME = new Set([0xc4, 0xc8, 0xcc]);

function jpegDimensions(bytes: Uint8Array): LogoDimensions | null {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (JPEG_STANDALONE.has(marker)) {
      at += 2;
      continue;
    }
    // Scan data before a frame header means there are no dimensions to trust.
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker >= 0xc0 && marker <= 0xcf && !JPEG_NOT_FRAME.has(marker)) {
      return { height: u16be(bytes, at + 5), width: u16be(bytes, at + 7) };
    }
    at += 2 + u16be(bytes, at + 2);
  }
  return null;
}

/** An animated WebP is refused, so a logo is one frame. */
function webpDimensions(bytes: Uint8Array): LogoDimensions | null {
  if (bytes.length < 30) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return {
      width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
      height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const bits = (bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)) >>> 0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    if ((bytes[20]! & 0x02) !== 0) return null;
    return {
      width: (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1,
      height: (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1,
    };
  }
  return null;
}

/** Read from the header alone, before any decoder runs, so the pixel cap holds ahead of the allocation. */
export function logoDimensions(
  bytes: Uint8Array,
  contentType: RasterLogoContentType,
): LogoDimensions | null {
  if (contentType === "image/png") return pngDimensions(bytes);
  if (contentType === "image/jpeg") return jpegDimensions(bytes);
  return webpDimensions(bytes);
}

export function withinPixelCap(dimensions: LogoDimensions): boolean {
  const { width, height } = dimensions;
  return (
    width > 0 &&
    height > 0 &&
    width <= LOGO_MAX_SIDE &&
    height <= LOGO_MAX_SIDE &&
    width * height <= LOGO_MAX_PIXELS
  );
}
