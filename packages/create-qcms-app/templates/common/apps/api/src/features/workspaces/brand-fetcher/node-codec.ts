/* eslint-disable no-restricted-imports -- the Node adapter at the process boundary, composed into Deps by main.ts; handlers stay Fetch-pure (R4). */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import decodeWebp, { init as initWebp } from "@jsquash/webp/decode.js";
import jpeg from "jpeg-js";
import pngjs from "pngjs";

import { LOGO_MAX_BYTES } from "@roonga/qcms-db";
import { sniffRasterLogo } from "@roonga/qcms-core";
import type { RasterLogoContentType } from "@roonga/qcms-core";

import { LogoRefused } from "./port.js";
import type { LogoCodec, ReencodedLogo } from "./port.js";
import { LOGO_MAX_PIXELS, logoDimensions, withinPixelCap } from "./logo-dimensions.js";

interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

let webpReady: Promise<void> | undefined;

function loadWebp(): Promise<void> {
  webpReady ??= (async () => {
    const wasmPath = createRequire(import.meta.url).resolve(
      "@jsquash/webp/codec/dec/webp_dec.wasm",
    );
    await initWebp(await WebAssembly.compile(await readFile(wasmPath)));
  })();
  return webpReady;
}

async function decode(bytes: Uint8Array, contentType: RasterLogoContentType): Promise<Rgba> {
  if (contentType === "image/png") {
    return pngjs.PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  }
  if (contentType === "image/jpeg") {
    return jpeg.decode(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      tolerantDecoding: false,
      maxResolutionInMP: LOGO_MAX_PIXELS / 1_000_000,
      maxMemoryUsageInMB: 64,
    });
  }
  await loadWebp();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return decodeWebp(copy.buffer);
}

/**
 * Re-encoded as PNG from the decoded pixels, so nothing of the original file but its
 * pixels survives: no metadata, no trailing payload, no second container.
 */
export function createLogoCodec(): LogoCodec {
  return {
    async reencode(bytes): Promise<ReencodedLogo> {
      const contentType = sniffRasterLogo(bytes);
      if (contentType === null) throw new LogoRefused("not-raster");
      const dimensions = logoDimensions(bytes, contentType);
      if (dimensions === null) throw new LogoRefused("not-raster");
      if (!withinPixelCap(dimensions)) throw new LogoRefused("too-many-pixels");

      let pixels: Rgba;
      try {
        pixels = await decode(bytes, contentType);
      } catch {
        throw new LogoRefused("not-raster");
      }
      if (
        pixels.width !== dimensions.width ||
        pixels.height !== dimensions.height ||
        pixels.data.byteLength !== pixels.width * pixels.height * 4
      ) {
        throw new LogoRefused("not-raster");
      }

      const image = new pngjs.PNG({ width: pixels.width, height: pixels.height });
      image.data = Buffer.from(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength);
      const encoded = pngjs.PNG.sync.write(image, { colorType: 6 });
      if (encoded.byteLength > LOGO_MAX_BYTES) throw new LogoRefused("too-large");
      const out = new Uint8Array(new ArrayBuffer(encoded.byteLength));
      out.set(encoded);
      return { contentType: "image/png", bytes: out, width: pixels.width, height: pixels.height };
    },
  };
}
