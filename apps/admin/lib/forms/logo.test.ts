import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { RASTER_LOGO_CONTENT_TYPES } from "@roonga/qcms-core";
import { describe, expect, it } from "vitest";

import { LOGO_ACCEPT, LOGO_MAX_BYTES, logoSizeRefusal } from "./logo.ts";

const DB_CONSTANT = fileURLToPath(
  new URL("../../../../packages/db/src/schema/control/workspace-themes.ts", import.meta.url),
);

describe("the picker's limits", () => {
  it("caps bytes where the stored column does", () => {
    const source = readFileSync(DB_CONSTANT, "utf8");
    const match = /export const LOGO_MAX_BYTES = ([\d_]+);/u.exec(source);
    expect(match, "the database package no longer declares LOGO_MAX_BYTES").not.toBeNull();
    expect(LOGO_MAX_BYTES).toBe(Number((match?.[1] ?? "").replaceAll("_", "")));
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
