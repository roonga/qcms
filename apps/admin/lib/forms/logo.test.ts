import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { RASTER_LOGO_CONTENT_TYPES } from "@roonga/qcms-core";
import { describe, expect, it } from "vitest";

import {
  LOGO_ACCEPT,
  LOGO_MAX_BYTES,
  LOGO_MAX_LABEL,
  LOGO_MAX_SIDE,
  logoSizeRefusal,
} from "./logo.ts";

const DB_CONSTANT = fileURLToPath(
  new URL("../../../../packages/db/src/schema/control/workspace-themes.ts", import.meta.url),
);

const CODEC_LIMITS = fileURLToPath(
  new URL("../../../api/src/features/workspaces/brand-fetcher/logo-dimensions.ts", import.meta.url),
);

function declared(source: string, name: string): number {
  const match = new RegExp(`export const ${name} = ([\\d_]+);`, "u").exec(source);
  expect(match, `${name} is no longer declared where this test reads it`).not.toBeNull();
  return Number((match?.[1] ?? "").replaceAll("_", ""));
}

describe("the picker's limits", () => {
  it("caps bytes where the stored column does", () => {
    expect(LOGO_MAX_BYTES).toBe(declared(readFileSync(DB_CONSTANT, "utf8"), "LOGO_MAX_BYTES"));
  });

  it("names the side the codec refuses beyond", () => {
    expect(LOGO_MAX_SIDE).toBe(declared(readFileSync(CODEC_LIMITS, "utf8"), "LOGO_MAX_SIDE"));
  });

  it("writes the byte cap as a label rather than carrying a second copy of it", () => {
    expect(LOGO_MAX_LABEL).toBe(`${String(LOGO_MAX_BYTES / 1024)} KB`);
  });

  it("offers only the raster types the API re-encodes", () => {
    // The sniff admits WebP, but the codec refuses it, so the picker may not offer it.
    expect(LOGO_ACCEPT.split(",")).toEqual(
      RASTER_LOGO_CONTENT_TYPES.filter((type) => type !== "image/webp"),
    );
  });

  it("names the sizes the upload route would refuse", () => {
    expect(logoSizeRefusal(0)).toBe("empty");
    expect(logoSizeRefusal(LOGO_MAX_BYTES)).toBeUndefined();
    expect(logoSizeRefusal(LOGO_MAX_BYTES + 1)).toBe("tooLarge");
  });
});
