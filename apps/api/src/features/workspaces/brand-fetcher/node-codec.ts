import { inflateSync } from "node:zlib";

import jpeg from "jpeg-js";
import pngjs from "pngjs";

import { LOGO_MAX_BYTES } from "@roonga/qcms-db";
import { sniffRasterLogo } from "@roonga/qcms-core";

import { LogoRefused } from "./port.js";
import type { LogoCodec, ReencodedLogo } from "./port.js";
import {
  LOGO_MAX_PIXELS,
  logoHeader,
  pngHeader,
  pngInflatedBytes,
  withinPixelCap,
} from "./logo-dimensions.js";

interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

export type BoundedInflate = (data: Buffer, options: { maxOutputLength: number }) => Buffer;

export interface LogoCodecOptions {
  /** The PNG pre-inflate; a test passes a wrapper to see the bound it was given. */
  readonly inflate?: BoundedInflate;
}

/**
 * jpeg-js counts its own allocations against this. Four components at the pixel cap, padded
 * to whole MCUs, need about 105 MB, so an image the header check admits always decodes,
 * and a frame the header check could not see is still bounded.
 */
const JPEG_MAX_MEMORY_MB = 128;

function decodePng(bytes: Uint8Array, inflate: BoundedInflate): Rgba {
  const png = pngHeader(bytes);
  if (!png.ok) throw new LogoRefused(png.reason);
  const expected = pngInflatedBytes(png.header);
  // Inflated here first, against the exact size the one IHDR allows, so a stream that
  // would grow past it stops at the bound instead of inside the decoder.
  const inflated = inflate(Buffer.concat(png.header.idat), { maxOutputLength: expected });
  if (inflated.byteLength !== expected) throw new LogoRefused("not-raster");
  return pngjs.PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

function decodeJpeg(bytes: Uint8Array): Rgba {
  return jpeg.decode(bytes, {
    useTArray: true,
    formatAsRGBA: true,
    tolerantDecoding: false,
    maxResolutionInMP: LOGO_MAX_PIXELS / 1_000_000,
    maxMemoryUsageInMB: JPEG_MAX_MEMORY_MB,
  });
}

/**
 * Re-encoded as PNG from the decoded pixels, so nothing of the original file but its
 * pixels survives: no metadata, no trailing payload, no second container. PNG and JPEG
 * only; a WebP is refused as unsupported.
 */
export function createLogoCodec(options: LogoCodecOptions = {}): LogoCodec {
  const inflate = options.inflate ?? inflateSync;
  return {
    reencode(bytes): Promise<ReencodedLogo> {
      return Promise.resolve().then(() => {
        const contentType = sniffRasterLogo(bytes);
        if (contentType === null) throw new LogoRefused("not-raster");
        const header = logoHeader(bytes, contentType);
        if (!header.ok) throw new LogoRefused(header.reason);
        if (!withinPixelCap(header)) throw new LogoRefused("too-many-pixels");

        let pixels: Rgba;
        try {
          pixels = contentType === "image/png" ? decodePng(bytes, inflate) : decodeJpeg(bytes);
        } catch (err: unknown) {
          if (err instanceof LogoRefused) throw err;
          throw new LogoRefused("not-raster");
        }
        if (
          pixels.width !== header.width ||
          pixels.height !== header.height ||
          pixels.data.byteLength !== pixels.width * pixels.height * 4
        ) {
          throw new LogoRefused("not-raster");
        }

        const image = new pngjs.PNG({ width: pixels.width, height: pixels.height });
        image.data = Buffer.from(
          pixels.data.buffer,
          pixels.data.byteOffset,
          pixels.data.byteLength,
        );
        const encoded = pngjs.PNG.sync.write(image, { colorType: 6 });
        if (encoded.byteLength > LOGO_MAX_BYTES) throw new LogoRefused("too-large");
        const out = new Uint8Array(new ArrayBuffer(encoded.byteLength));
        out.set(encoded);
        return { contentType: "image/png", bytes: out, width: pixels.width, height: pixels.height };
      });
    },
  };
}
