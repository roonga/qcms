export const LOGO_MAX_PIXELS = 4_194_304;
export const LOGO_MAX_SIDE = 4_096;

export interface LogoDimensions {
  readonly width: number;
  readonly height: number;
}

/** What the header says, or why the image is refused before any decoder runs. */
export type LogoHeader =
  | { readonly ok: true; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly reason: "not-raster" | "unsupported" };

export interface PngHeader extends LogoDimensions {
  readonly bitDepth: number;
  readonly colorType: number;
  /** Every IDAT chunk's data, in order, as the zlib stream the image is inflated from. */
  readonly idat: readonly Uint8Array[];
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

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xff_ff_ff_ff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xff_ff_ff_ff) >>> 0;
}

const PNG_SIGNATURE_LENGTH = 8;

/** Channels per pixel by colour type, with the bit depths the PNG specification allows for each. */
const PNG_COLOR_TYPES: ReadonlyMap<number, { channels: number; depths: readonly number[] }> =
  new Map([
    [0, { channels: 1, depths: [1, 2, 4, 8, 16] }],
    [2, { channels: 3, depths: [8, 16] }],
    [3, { channels: 1, depths: [1, 2, 4, 8] }],
    [4, { channels: 2, depths: [8, 16] }],
    [6, { channels: 4, depths: [8, 16] }],
  ]);

interface PngChunk {
  readonly type: string;
  readonly data: Uint8Array;
}

/** Every chunk in order, each CRC checked, ending at IEND with nothing after it; null otherwise. */
function pngChunks(bytes: Uint8Array): PngChunk[] | null {
  const chunks: PngChunk[] = [];
  let at = PNG_SIGNATURE_LENGTH;
  while (chunks.at(-1)?.type !== "IEND") {
    if (at + 12 > bytes.length) return null;
    const length = u32be(bytes, at);
    if (length > bytes.length - at - 12) return null;
    if (crc32(bytes.subarray(at + 4, at + 8 + length)) !== u32be(bytes, at + 8 + length)) {
      return null;
    }
    chunks.push({ type: ascii(bytes, at + 4, 4), data: bytes.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return at === bytes.length ? chunks : null;
}

/**
 * Walks every chunk and checks every CRC, because the decoder sizes its work from the last
 * IHDR it meets: exactly one IHDR, first, then IEND last with nothing after it. An
 * interlaced PNG is refused, since the decoder inflates it with no bound on the output.
 */
export function pngHeader(
  bytes: Uint8Array,
): { readonly ok: true; readonly header: PngHeader } | Extract<LogoHeader, { ok: false }> {
  const refused = { ok: false, reason: "not-raster" } as const;
  const chunks = pngChunks(bytes);
  if (chunks === null) return refused;
  const ihdrs = chunks.filter((chunk) => chunk.type === "IHDR");
  const ihdr = chunks[0]?.data;
  if (ihdrs.length !== 1 || chunks[0]?.type !== "IHDR" || ihdr?.length !== 13) return refused;
  const idat = chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data);
  if (idat.length === 0) return refused;

  const bitDepth = ihdr[8]!;
  const colorType = ihdr[9]!;
  const kind = PNG_COLOR_TYPES.get(colorType);
  if (kind === undefined || !kind.depths.includes(bitDepth)) return refused;
  if (ihdr[10] !== 0 || ihdr[11] !== 0) return refused;
  if (ihdr[12] !== 0) return { ok: false, reason: "unsupported" };
  return {
    ok: true,
    header: { width: u32be(ihdr, 0), height: u32be(ihdr, 4), bitDepth, colorType, idat },
  };
}

/** The exact size of a non-interlaced PNG's inflated image data: each row's bytes and its filter byte. */
export function pngInflatedBytes(header: PngHeader): number {
  const channels = PNG_COLOR_TYPES.get(header.colorType)!.channels;
  return (Math.ceil((header.width * channels * header.bitDepth) / 8) + 1) * header.height;
}

const JPEG_STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8]);
const JPEG_NOT_FRAME = new Set([0xc4, 0xc8, 0xcc]);
/** Grey, YCbCr and CMYK. More components multiply the decoder's memory past what the pixel cap allows for. */
const JPEG_COMPONENTS = new Set([1, 3, 4]);

function jpegHeader(bytes: Uint8Array): LogoHeader {
  const refused = { ok: false, reason: "not-raster" } as const;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return refused;
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
    if (marker === 0xda || marker === 0xd9) return refused;
    if (marker >= 0xc0 && marker <= 0xcf && !JPEG_NOT_FRAME.has(marker)) {
      if (!JPEG_COMPONENTS.has(bytes[at + 9]!)) return refused;
      return { ok: true, height: u16be(bytes, at + 5), width: u16be(bytes, at + 7) };
    }
    at += 2 + u16be(bytes, at + 2);
  }
  return refused;
}

/**
 * Read from the header alone, before any decoder runs, so the pixel cap holds ahead of the
 * allocation. PNG and JPEG only: any other raster type is unsupported.
 */
export function logoHeader(bytes: Uint8Array, contentType: string): LogoHeader {
  if (contentType === "image/png") {
    const png = pngHeader(bytes);
    return png.ok ? { ok: true, width: png.header.width, height: png.header.height } : png;
  }
  if (contentType === "image/jpeg") return jpegHeader(bytes);
  return { ok: false, reason: "unsupported" };
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
