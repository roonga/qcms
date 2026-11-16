import { describe, expect, it } from "vitest";

import {
  formAppearanceCss,
  formLogoSrc,
  parseFormAppearance,
  sessionIdFromPath,
  type FormAppearance,
} from "./form-appearance.js";

const LOGO = "a".repeat(64);

function palette(primary: string): Record<string, string> {
  return { primary, "primary-foreground": "#FFFFFF", background: "#fafafa", text: "#111111" };
}

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    palettes: {
      light: palette("#1D4ED8"),
      dark: palette("#93c5fd"),
      lightHighContrast: palette("#0a2a8a"),
      darkHighContrast: palette("#c7dcff"),
    },
    logo: LOGO,
    face: "atkinson",
    corners: "rounded",
    density: "compact",
    textSize: 18,
    progress: "side-rail",
    pageTint: false,
    ...overrides,
  };
}

function palettes(): Record<string, unknown> {
  return raw()["palettes"] as Record<string, unknown>;
}

function parsed(overrides: Record<string, unknown> = {}): FormAppearance {
  const appearance = parseFormAppearance(raw(overrides));
  if (appearance === null) throw new Error("fixture appearance did not parse");
  return appearance;
}

describe("parseFormAppearance", () => {
  it("reads the axes the portal applies, lower-casing colours", () => {
    const appearance = parsed();
    expect(appearance.palettes.light["primary"]).toBe("#1d4ed8");
    expect(appearance).toMatchObject({
      logo: LOGO,
      face: "atkinson",
      corners: "rounded",
      density: "compact",
    });
  });

  it("is null for a version with no appearance", () => {
    expect(parseFormAppearance(null)).toBeNull();
    expect(parseFormAppearance(undefined)).toBeNull();
  });

  it.each([
    ["a colour that is not hex", { palettes: { ...palettes(), light: { primary: "red" } } }],
    [
      "a value that would close the declaration",
      { palettes: { ...palettes(), dark: { primary: "#000000;}body{x:y" } } },
    ],
    [
      "a token name that is not a bare token",
      { palettes: { ...palettes(), light: { "primary;x": "#000000" } } },
    ],
    ["a missing palette", { palettes: { light: palette("#000000") } }],
    ["a face outside the registry", { face: "papyrus" }],
    ["unknown corners", { corners: "wobbly" }],
    ["unknown density", { density: "cosy" }],
    ["a logo key that is not a digest", { logo: "../../etc/passwd" }],
  ])("falls back to the deployment for %s", (_name, overrides) => {
    expect(parseFormAppearance(raw(overrides as Record<string, unknown>))).toBeNull();
  });
});

describe("formAppearanceCss", () => {
  it("writes one block per palette, keyed to the root's mode classes", () => {
    const css = formAppearanceCss(parsed());
    const blocks = css.split("\n");
    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toBe(
      "html:root[data-qcms-form-appearance]:not(.dark):not(.hc){--color-primary:#1d4ed8;--color-primary-foreground:#ffffff;--color-background:#fafafa;--color-text:#111111;}",
    );
    expect(blocks[1]).toContain("html:root[data-qcms-form-appearance].dark:not(.hc){");
    expect(blocks[1]).toContain("--color-primary:#93c5fd;");
    expect(blocks[2]).toContain("html:root[data-qcms-form-appearance].hc:not(.dark){");
    expect(blocks[2]).toContain("--color-primary:#0a2a8a;");
    expect(blocks[3]).toContain("html:root[data-qcms-form-appearance].dark.hc{");
    expect(blocks[3]).toContain("--color-primary:#c7dcff;");
  });

  it("carries nothing a style element could be broken out of", () => {
    expect(formAppearanceCss(parsed())).toMatch(/^[a-z0-9#:;{}()[\]\-.\n]+$/u);
  });
});

describe("formLogoSrc", () => {
  it("serves the form's logo through the portal's own route, under the environment prefix", () => {
    expect(formLogoSrc(parsed(), "")).toBe(`/logo/${LOGO}`);
    expect(formLogoSrc(parsed(), "/test")).toBe(`/test/logo/${LOGO}`);
  });

  it("is undefined when the form carries no logo", () => {
    expect(formLogoSrc(parsed({ logo: null }), "")).toBeUndefined();
  });
});

describe("sessionIdFromPath", () => {
  it("names the session of a step page", () => {
    expect(sessionIdFromPath("/s/ses_1")).toBe("ses_1");
    expect(sessionIdFromPath("/s/ses_1/")).toBe("ses_1");
  });

  it.each([null, "/", "/f/road-cover", "/s/ses_1/step", "/done", "/s/"])(
    "names none for %s",
    (path) => {
      expect(sessionIdFromPath(path)).toBeUndefined();
    },
  );
});
