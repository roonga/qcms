import { APPEARANCE_FACES } from "@roonga/qcms-core";
import { describe, expect, it } from "vitest";

import { PREVIEW_THEMES } from "../preview-theme.ts";
import { faceOptions, shippedThemeOptions } from "./appearance-options.ts";

describe("the drawer's choices", () => {
  it("offers one row per shipped theme, named for the respondent theme", () => {
    const options = shippedThemeOptions();
    expect(options).toHaveLength(PREVIEW_THEMES.length);
    expect(options.map((option) => option.name)).toEqual(["Slate", "Harbor", "Sand", "Plum"]);
    expect(options.every((option) => option.logo === null)).toBe(true);
  });

  it("offers every registry face, with the system entry named rather than left blank", () => {
    const faces = faceOptions();
    expect(faces.map((face) => face.key)).toEqual(APPEARANCE_FACES.map((face) => face.key));
    expect(faces.map((face) => face.label)).toEqual(
      APPEARANCE_FACES.map((face) => face.family ?? "System default"),
    );
  });
});
