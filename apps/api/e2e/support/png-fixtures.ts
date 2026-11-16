import { crc32, deflateSync } from "node:zlib";

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** One chunk with its length and a correct CRC. */
export function pngChunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData) >>> 0);
  return Buffer.concat([length, typeAndData, crc]);
}

export interface IhdrFields {
  readonly bitDepth?: number;
  readonly colorType?: number;
  readonly interlace?: number;
}

export function ihdrChunk(width: number, height: number, fields: IhdrFields = {}): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = fields.bitDepth ?? 8;
  data[9] = fields.colorType ?? 6;
  data[12] = fields.interlace ?? 0;
  return pngChunk("IHDR", data);
}

export function idatChunk(raw: Buffer): Buffer {
  return pngChunk("IDAT", deflateSync(raw, { level: 9 }));
}

export const IEND = pngChunk("IEND");

export function craftPng(chunks: readonly Buffer[]): Buffer {
  return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

/** The same file with its IHDR rewritten and its CRC recomputed, so only the header lies. */
export function withIhdr(png: Buffer, width: number, height: number, interlace = 0): Buffer {
  const copy = Buffer.from(png);
  copy.writeUInt32BE(width, 16);
  copy.writeUInt32BE(height, 20);
  copy[28] = interlace;
  copy.writeUInt32BE(crc32(copy.subarray(12, 29)) >>> 0, 29);
  return copy;
}
