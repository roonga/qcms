import { describe, expect, it } from "vitest";

import {
  APPEARANCE_CLASSES,
  CONTRASTS,
  MODE_COOKIE,
  MODE_MAX_AGE_SECONDS,
  POLARITIES,
  type Appearance,
  appearanceClassName,
  appearanceClasses,
  appearanceValue,
  modeCookie,
  parseAppearance,
} from "./appearance.ts";

const ALL: readonly Appearance[] = POLARITIES.flatMap((polarity) =>
  CONTRASTS.map((contrast) => ({ polarity, contrast })),
);

describe("the root classes for each state", () => {
  it("maps the six states the control can select", () => {
    expect(appearanceClasses({ polarity: "auto", contrast: "normal" })).toEqual([]);
    expect(appearanceClasses({ polarity: "light", contrast: "normal" })).toEqual(["light"]);
    expect(appearanceClasses({ polarity: "dark", contrast: "normal" })).toEqual(["dark"]);
    expect(appearanceClasses({ polarity: "auto", contrast: "high" })).toEqual(["hc"]);
    expect(appearanceClasses({ polarity: "light", contrast: "high" })).toEqual(["light", "hc"]);
    expect(appearanceClasses({ polarity: "dark", contrast: "high" })).toEqual(["dark", "hc"]);
  });

  // A class the sheet has no block for would paint nothing, and a class the client swap
  // does not know about would never be removed again.
  it("stamps only classes the swap owns", () => {
    for (const appearance of ALL) {
      for (const className of appearanceClasses(appearance)) {
        expect(APPEARANCE_CLASSES, appearanceValue(appearance)).toContain(className);
      }
    }
  });

  // An empty class attribute on `<html>` is not the same document as no attribute, and
  // the no-flash spec reads the attribute.
  it("renders no attribute for Auto plus normal contrast, and none for no choice", () => {
    expect(appearanceClassName({ polarity: "auto", contrast: "normal" })).toBeUndefined();
    expect(appearanceClassName(undefined)).toBeUndefined();
    expect(appearanceClassName({ polarity: "dark", contrast: "high" })).toBe("dark hc");
  });

  // High contrast is the second axis, not a third polarity: it has to survive every
  // polarity, including the one that carries no class of its own.
  it("keeps high contrast orthogonal to polarity", () => {
    for (const polarity of POLARITIES) {
      expect(appearanceClasses({ polarity, contrast: "high" })).toContain("hc");
      expect(appearanceClasses({ polarity, contrast: "normal" })).not.toContain("hc");
    }
  });
});

describe("parsing the stored choice", () => {
  it("round-trips every state through the cookie value", () => {
    for (const appearance of ALL) {
      expect(parseAppearance(appearanceValue(appearance)), appearanceValue(appearance)).toEqual(
        appearance,
      );
    }
  });

  // A cookie written when high contrast was light-only must keep its meaning.
  it("reads a legacy hc cookie as Light plus high contrast", () => {
    expect(parseAppearance("hc")).toEqual({ polarity: "light", contrast: "high" });
    expect(appearanceClasses(parseAppearance("hc")!)).toEqual(["light", "hc"]);
  });

  it("reads a legacy single-axis cookie as that polarity at normal contrast", () => {
    expect(parseAppearance("light")).toEqual({ polarity: "light", contrast: "normal" });
    expect(parseAppearance("dark")).toEqual({ polarity: "dark", contrast: "normal" });
  });

  // Substituting a default here would pin a new operator to it on a machine that
  // prefers the other field, which is the whole reason the sheet has an auto block.
  it("returns undefined for no cookie and for nonsense, never a default", () => {
    for (const raw of [undefined, "", "sepia", "dark-hc-extra", "-hc", "HC", "auto-HC", "hcx"]) {
      expect(parseAppearance(raw), String(raw)).toBeUndefined();
    }
  });
});

describe("the cookie attributes", () => {
  it("writes a bare keyword, path, a year and SameSite=Lax", () => {
    const written = modeCookie({ polarity: "dark", contrast: "high" }, false);
    expect(written).toBe(
      `${MODE_COOKIE}=dark-hc; Path=/; Max-Age=${MODE_MAX_AGE_SECONDS}; SameSite=Lax`,
    );
  });

  it("adds Secure only when asked", () => {
    const appearance: Appearance = { polarity: "auto", contrast: "normal" };
    expect(modeCookie(appearance, true).endsWith("; Secure")).toBe(true);
    expect(modeCookie(appearance, false)).not.toContain("Secure");
  });

  // Nothing here escapes a value, so every value has to be a keyword by construction.
  it("never writes a character that would need escaping", () => {
    for (const appearance of ALL) {
      expect(appearanceValue(appearance)).toMatch(/^[a-z-]+$/u);
    }
  });
});
