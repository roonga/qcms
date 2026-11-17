import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const ADMIN = read("./globals.css");
const UI_SHEETS = [
  read("../../../packages/ui/src/theme.css"),
  read("../../../packages/ui/src/theme-components.css"),
];

const DEVICE_PREFIX = ".qcms-builder-device ";

function stripComments(css: string): string {
  return css.replaceAll(/\/\*[\s\S]*?\*\//gu, "");
}

function blocks(css: string, atRule: string): { condition: string; body: string }[] {
  const found: { condition: string; body: string }[] = [];
  const source = stripComments(css);
  const pattern = new RegExp(`${atRule} \\(((?:min|max)-width: [^)]+)\\) \\{`, "gu");
  for (const match of source.matchAll(pattern)) {
    let depth = 1;
    let at = match.index + match[0].length;
    const start = at;
    while (depth > 0 && at < source.length) {
      if (source[at] === "{") depth += 1;
      if (source[at] === "}") depth -= 1;
      at += 1;
    }
    found.push({ condition: match[1] ?? "", body: source.slice(start, at - 1) });
  }
  return found;
}

function rules(body: string): string[] {
  return body
    .split("}")
    .map((rule) => rule.replaceAll(/\s+/gu, " ").trim())
    .filter((rule) => rule !== "")
    .map((rule) => rule.replaceAll(DEVICE_PREFIX, ""));
}

function sectionPads(css: string, selectorPrefix: string): Record<string, string> {
  const source = stripComments(css);
  const out: Record<string, string> = {};
  const pattern = new RegExp(
    `^${selectorPrefix.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(\\.density-[a-z]+)? \\{[^}]*--space-section-pad: ([^;]+);`,
    "gmu",
  );
  for (const match of source.matchAll(pattern)) out[match[1] ?? "base"] = match[2] ?? "";
  return out;
}

describe("the builder's device frame and the portal's breakpoints", () => {
  const media = UI_SHEETS.flatMap((sheet) => blocks(sheet, "@media"));

  it("finds the viewport rules the frame has to answer", () => {
    expect(media.map((block) => block.condition).sort()).toEqual([
      "max-width: 40rem",
      "min-width: 40rem",
    ]);
  });

  it("answers every viewport width rule with the same rules on the frame's container", () => {
    const container = blocks(ADMIN, "@container qcms-respondent");
    for (const block of media) {
      const mirror = container.find((candidate) => candidate.condition === block.condition);
      expect(mirror, `no container rule for ${block.condition}`).toBeDefined();
      const mirrored = rules(mirror?.body ?? "");
      for (const rule of rules(block.body)) expect(mirrored).toContain(rule);
    }
  });

  it("restates the narrow section padding of every density inside the frame", () => {
    const base = sectionPads(UI_SHEETS[0] ?? "", ":is(:root, [data-qcms-theme-scope])");
    const restated = sectionPads(ADMIN, ".qcms-builder-device [data-qcms-theme-scope]");
    expect(Object.keys(base).sort()).toEqual([".density-compact", ".density-spacious", "base"]);
    expect(restated).toEqual(base);
  });
});
