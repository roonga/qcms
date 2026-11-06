import { describe, expect, it } from "vitest";

import { PWA_ACCENT_COLOR, PWA_GROUND_COLOR } from "./brand";
import { adminManifest } from "./manifest";

const manifest = adminManifest();

describe("the admin web app manifest", () => {
  it("carries every member Chromium requires to offer an install", () => {
    expect(manifest.name).toBe("QCMS");
    expect(manifest.short_name).toBe("QCMS");
    expect(manifest.start_url).toBe("/questions");
    expect(manifest.display).toBe("standalone");
    expect(manifest.prefer_related_applications).toBeUndefined();
  });

  it("offers a 192 and a 512 PNG under both purposes", () => {
    for (const size of ["192x192", "512x512"]) {
      const icons = (manifest.icons ?? []).filter((entry) => entry.sizes === size);
      expect(
        icons.map((icon) => icon.type),
        size,
      ).toEqual(["image/png", "image/png"]);
      expect(icons.map((icon) => icon.purpose).sort(), size).toEqual(["any", "maskable"]);
      expect(new Set(icons.map((icon) => icon.src)).size, size).toBe(1);
    }
  });

  it("names only same-origin icon paths", () => {
    for (const icon of manifest.icons ?? []) {
      expect(icon.src).toMatch(/^\//);
    }
  });

  it("takes its colours from the token sheet rather than naming new ones", () => {
    expect(manifest.background_color).toBe(PWA_GROUND_COLOR);
    expect(manifest.theme_color).toBe(PWA_ACCENT_COLOR);
  });

  it("keeps an identity that survives moving the start screen", () => {
    expect(manifest.id).toBe("/");
    expect(manifest.id).not.toBe(manifest.start_url);
    expect(manifest.scope).toBe("/");
  });
});
