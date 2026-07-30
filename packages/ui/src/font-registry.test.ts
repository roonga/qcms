/**
 * The font registry, measured rather than asserted (task 052, exit criteria 1+2).
 *
 * What this suite proves about the manifest itself, so the browser suite only has
 * to prove that the shipped CSS reaches a rendered page:
 *
 *  - every declared face is a REAL woff2 committed in this repository (the `wOF2`
 *    magic number is checked, so a placeholder or a 404-page-saved-as-a-font
 *    fails here rather than rendering as a silent fallback in production);
 *  - `fonts.css` is exactly what the manifest renders, which is what makes
 *    add/remove a ONE-ENTRY change: a hand edit to the CSS, or a manifest edit
 *    without a regenerate, fails;
 *  - adding or removing one entry changes nothing but that entry's own blocks
 *    (demonstrated by rendering a mutated registry and diffing);
 *  - System is present, downloads nothing, and cannot be curated away;
 *  - every family carries a permissive license from the allow-list AND its
 *    upstream copyright notice, and both license texts ship beside the binaries;
 *  - a font entry sets `--font-portal` and NOTHING else, which is the structural
 *    reason no font selection can lower a WCAG 1.4.12 floor. The floors are
 *    re-measured on rendered text under every shipped font by
 *    `apps/portal/e2e/fonts.pw.ts`.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FONT_GROUPS,
  FONT_REGISTRY,
  SYSTEM_FONT_KEY,
  fontByKey,
  fontChoices,
  fontClass,
  renderFontsCss,
  type FontEntry,
} from "./font-registry.ts";

const SRC = import.meta.dirname;
const FONT_DIR = join(SRC, "fonts");
const FONTS_CSS = readFileSync(join(SRC, "fonts.css"), "utf8");
const THEME_CSS = readFileSync(join(SRC, "theme.css"), "utf8");
const NOTICE = readFileSync(join(FONT_DIR, "NOTICE.md"), "utf8");

/** Permissive, MIT-redistributable licenses (CONTRIBUTING dependency policy). */
const ALLOWED_LICENSES = new Set(["OFL-1.1", "Apache-2.0"]);

/** The groups the task requires, and the members it names explicitly. */
const REQUIRED_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  System: [SYSTEM_FONT_KEY],
  Accessibility: ["atkinson", "lexend", "opendyslexic"],
  "Playful & Kids": ["andika"],
  Monospace: ["jetbrainsmono", "geistmono"],
};

/**
 * Formatting is Prettier's business (the root `lint` runs `prettier --check .`,
 * and Prettier reflows a long custom-property value onto a continuation line);
 * content is the manifest's. Comparing whitespace-normalized text keeps the drift
 * guard exact about content without duplicating Prettier's line breaking.
 */
function normalize(css: string): string {
  return css.replaceAll(/\s+/gu, " ").trim();
}

/** CSS with comments removed, so a rule-level assertion cannot match prose. */
function stripComments(css: string): string {
  return css.replaceAll(/\/\*[\s\S]*?\*\//gu, "");
}

/**
 * Every RULE of a stylesheet, comments and group banners stripped and whitespace
 * normalized. Comparing rule sets is what makes the add/remove assertions exact:
 * the diff is the entry's own blocks and nothing else, with no dependence on where
 * a comment happened to sit.
 */
function rules(css: string): readonly string[] {
  // Scanned with indexOf rather than a regex: a `selector { body }` pattern reads
  // naturally but backtracks (sonarjs/super-linear-regex), and these stylesheets
  // have no nested blocks, so a linear scan is both simpler and exact.
  const text = stripComments(css);
  const out: string[] = [];
  for (let index = 0; index < text.length;) {
    const open = text.indexOf("{", index);
    if (open < 0) break;
    const close = text.indexOf("}", open);
    if (close < 0) break;
    out.push(normalize(`${text.slice(index, open)}{${text.slice(open + 1, close)}}`));
    index = close + 1;
  }
  return out;
}

/** The value of the first declaration of `name` in a stylesheet, trimmed. */
function firstDeclaration(css: string, name: string): string | undefined {
  const start = css.indexOf(`${name}:`);
  if (start < 0) return undefined;
  const end = css.indexOf(";", start);
  if (end < 0) return undefined;
  return css.slice(start + name.length + 1, end).trim();
}

/** The `:root.font-*` blocks of a stylesheet, as selector -> declarations text. */
function fontBlocks(css: string): ReadonlyMap<string, string> {
  const blocks = new Map<string, string>();
  const pattern = /(?<selector>:root\.font-[\w-]+)\s*\{(?<body>[^}]*)\}/gu;
  for (const match of css.matchAll(pattern)) {
    blocks.set((match.groups?.selector ?? "").trim(), (match.groups?.body ?? "").trim());
  }
  return blocks;
}

describe("the manifest is well formed", () => {
  it("ships the System entry plus 22 self-hosted families", () => {
    expect(FONT_REGISTRY).toHaveLength(23);
    expect(FONT_REGISTRY.filter((entry) => entry.faces.length > 0)).toHaveLength(22);
  });

  it("keys are unique and CSS-class safe", () => {
    const keys = FONT_REGISTRY.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys)
      expect(key, `${key} is not a CSS-safe token`).toMatch(/^[a-z][a-z0-9]*$/u);
  });

  it("families are unique and every entry names a declared group", () => {
    const families = FONT_REGISTRY.map((entry) => entry.family).filter((name) => name !== null);
    expect(new Set(families).size).toBe(families.length);
    for (const entry of FONT_REGISTRY) {
      expect(FONT_GROUPS, `${entry.key} group`).toContain(entry.group);
    }
  });

  it("covers every group the task names, with the families it names", () => {
    for (const [group, members] of Object.entries(REQUIRED_MEMBERS)) {
      const keys = FONT_REGISTRY.filter((entry) => entry.group === group).map((e) => e.key);
      for (const member of members) expect(keys, `${group} is missing ${member}`).toContain(member);
    }
    // Every declared group is actually populated - no empty optgroup for 053.
    for (const group of FONT_GROUPS) {
      expect(
        FONT_REGISTRY.some((entry) => entry.group === group),
        `group ${group} has no entries`,
      ).toBe(true);
    }
  });

  it("every entry's stack starts with its own family and ends in a CSS generic", () => {
    const generics = ["sans-serif", "serif", "monospace"];
    for (const entry of FONT_REGISTRY) {
      if (entry.family !== null) {
        expect(entry.stack.startsWith(`"${entry.family}", `), entry.key).toBe(true);
      }
      const last = entry.stack.split(",").at(-1)?.trim() ?? "";
      expect(generics, `${entry.key} stack ends with "${last}"`).toContain(last);
    }
  });

  it("fontByKey and fontClass agree with the manifest", () => {
    for (const entry of FONT_REGISTRY) {
      expect(fontByKey(entry.key)).toBe(entry);
      expect(fontClass(entry.key)).toBe(`font-${entry.key}`);
    }
    expect(fontByKey("papyrus")).toBeUndefined();
  });
});

describe("System is always present and never removable", () => {
  const system = fontByKey(SYSTEM_FONT_KEY);

  it("is the first entry, downloads nothing, and needs no license notice", () => {
    expect(system).toBeDefined();
    expect(FONT_REGISTRY[0]).toBe(system);
    expect(system?.faces).toEqual([]);
    expect(system?.family).toBeNull();
    expect(system?.license).toBeNull();
  });

  it("restates the base --font-portal value from theme.css byte for byte", () => {
    const base = firstDeclaration(THEME_CSS, "--font-portal");
    expect(base, "theme.css declares no base --font-portal").toBeDefined();
    expect(system?.stack).toBe(base);
  });

  it("survives every curation, including one that excludes it", () => {
    for (const keys of [[], ["inter"], ["papyrus"], ["inter", "papyrus"], ["jetbrainsmono"]]) {
      expect(
        fontChoices(keys).some((entry) => entry.key === SYSTEM_FONT_KEY),
        `curation ${JSON.stringify(keys)} dropped System`,
      ).toBe(true);
    }
    // An empty or all-unknown curation means "offer everything", never "nothing".
    expect(fontChoices([])).toEqual(FONT_REGISTRY);
    expect(fontChoices(["papyrus"])).toEqual(FONT_REGISTRY);
    expect(fontChoices(["inter"]).map((entry) => entry.key)).toEqual([SYSTEM_FONT_KEY, "inter"]);
  });
});

describe("every declared face is a real, committed woff2", () => {
  it("exists on disk and carries the woff2 magic number", () => {
    for (const entry of FONT_REGISTRY) {
      for (const face of entry.faces) {
        const path = join(FONT_DIR, face.file);
        expect(existsSync(path), `${entry.key}: ${face.file} is not committed`).toBe(true);
        const head = readFileSync(path).subarray(0, 4).toString("latin1");
        expect(head, `${entry.key}: ${face.file} is not a woff2 (header "${head}")`).toBe("wOF2");
      }
    }
  });

  // Ships each distinct set of bytes exactly once. Upstream serves some families
  // (Lexend) as a VARIABLE font, where the css2 API returns the same file for every
  // requested weight: naively saving it per weight silently commits the same bytes
  // twice. The manifest points both faces at one file instead, and this is the
  // guard that keeps the next such family from slipping through.
  it("commits no two byte-identical font files", () => {
    const byDigest = new Map<string, string[]>();
    for (const name of readdirSync(FONT_DIR).filter((entry) => entry.endsWith(".woff2"))) {
      const digest = createHash("sha256")
        .update(readFileSync(join(FONT_DIR, name)))
        .digest("hex");
      byDigest.set(digest, [...(byDigest.get(digest) ?? []), name]);
    }
    const duplicates = [...byDigest.values()].filter((names) => names.length > 1);
    expect(duplicates, `duplicate font bytes: ${JSON.stringify(duplicates)}`).toEqual([]);
  });

  it("leaves no orphan binary in the fonts directory", () => {
    const declared = new Set(FONT_REGISTRY.flatMap((entry) => entry.faces.map((f) => f.file)));
    const onDisk = readdirSync(FONT_DIR).filter((name) => name.endsWith(".woff2"));
    expect([...onDisk].sort()).toEqual([...declared].sort());
  });

  it("gives the Accessibility group a bold weight and the rest regular only", () => {
    for (const entry of FONT_REGISTRY) {
      if (entry.faces.length === 0) continue;
      const weights = entry.faces.map((face) => face.weight);
      expect(weights, `${entry.key} has no 400 weight`).toContain(400);
      expect(weights, entry.key).toEqual(entry.group === "Accessibility" ? [400, 700] : [400]);
    }
  });
});

describe("licensing is complete and permissive", () => {
  it("every self-hosted family declares an allow-listed license", () => {
    for (const entry of FONT_REGISTRY) {
      if (entry.faces.length === 0) continue;
      const disjuncts = (entry.license ?? "").split(" OR ").map((part) => part.trim());
      expect(disjuncts.length, `${entry.key} declares no license`).toBeGreaterThan(0);
      for (const spdx of disjuncts) {
        expect(ALLOWED_LICENSES, `${entry.key} license ${spdx}`).toContain(spdx);
      }
    }
  });

  it("ships the text of every license it claims", () => {
    const claimed = new Set(
      FONT_REGISTRY.flatMap((entry) => (entry.license ?? "").split(" OR "))
        .map((part) => part.trim())
        .filter((part) => part !== ""),
    );
    for (const spdx of claimed) {
      const path = join(FONT_DIR, `LICENSE-${spdx}.txt`);
      expect(existsSync(path), `no license text for ${spdx}`).toBe(true);
      expect(readFileSync(path, "utf8").length).toBeGreaterThan(1000);
    }
  });

  // The obligation OFL-1.1 (section 2) and Apache-2.0 (section 4a) actually place
  // on a redistribution: the copyright notice travels with the bytes.
  it("reproduces every upstream copyright notice verbatim in NOTICE.md", () => {
    for (const entry of FONT_REGISTRY) {
      if (entry.copyright === null) continue;
      expect(NOTICE, `NOTICE.md is missing the ${entry.label} notice`).toContain(entry.copyright);
      expect(NOTICE, `NOTICE.md is missing ${entry.label}`).toContain(entry.label);
    }
  });
});

describe("fonts.css is generated from the manifest", () => {
  it("matches what the manifest renders today", () => {
    expect(normalize(FONTS_CSS)).toBe(normalize(renderFontsCss()));
  });

  it("declares one @font-face per self-hosted weight, all same-origin relative", () => {
    const faces = [...FONTS_CSS.matchAll(/@font-face\s*\{[^}]*\}/gu)].map((m) => m[0]);
    const expected = FONT_REGISTRY.reduce((n, entry) => n + entry.faces.length, 0);
    expect(faces).toHaveLength(expected);
    for (const face of faces) {
      const url = /url\("(?<url>[^"]+)"\)/u.exec(face)?.groups?.url ?? "";
      expect(url, `absolute or remote font URL: ${url}`).toMatch(/^\.\/fonts\/[\w-]+\.woff2$/u);
    }
    // The whole point: no RULE in this stylesheet can reach off-origin. (The
    // comments legitimately carry upstream project URLs in the copyright notices,
    // so the check is on the CSS with comments stripped.)
    expect(stripComments(FONTS_CSS)).not.toMatch(/https?:\/\//u);
  });

  it("gives every entry a :root.font-<key> block that sets --font-portal ONLY", () => {
    const blocks = fontBlocks(FONTS_CSS);
    expect(blocks.size).toBe(FONT_REGISTRY.length);
    for (const entry of FONT_REGISTRY) {
      const body = blocks.get(`:root.${fontClass(entry.key)}`);
      expect(body, `no block for ${entry.key}`).toBeDefined();
      const declared = (body ?? "")
        .split(";")
        .map((part) => part.slice(0, part.indexOf(":")).trim())
        .filter((name) => name.startsWith("--"));
      // A font entry may never touch a --type-* token: those carry the WCAG
      // 1.4.12 floors, and no font selection is allowed to lower one.
      expect(declared, `${entry.key} declares more than the family token`).toEqual([
        "--font-portal",
      ]);
      expect(normalize(body ?? "")).toBe(`--font-portal: ${entry.stack};`);
    }
  });
});

describe("add and remove are one-entry manifest changes", () => {
  const ADDED: FontEntry = {
    key: "probefont",
    label: "Probe Font",
    family: "Probe Font",
    group: "Popular",
    stack: '"Probe Font", ui-sans-serif, sans-serif',
    faces: [{ weight: 400, file: "probefont-400.woff2" }],
    license: "OFL-1.1",
    copyright: "Copyright 2026 The Probe Font Project Authors",
    note: "test fixture",
  };

  it("adding one entry adds only that entry's own blocks", () => {
    const before = rules(renderFontsCss(FONT_REGISTRY));
    const after = rules(renderFontsCss([...FONT_REGISTRY, ADDED]));
    const added = after.filter((rule) => !before.includes(rule));
    // Exactly two rules appear: its @font-face and its :root.font-probefont block.
    expect(added).toEqual([
      '@font-face { font-family: "Probe Font"; font-style: normal; font-weight: 400;' +
        ' font-display: swap; src: url("./fonts/probefont-400.woff2") format("woff2"); }',
      ':root.font-probefont { --font-portal: "Probe Font", ui-sans-serif, sans-serif; }',
    ]);
    // And nothing that was there before is gone.
    expect(before.filter((rule) => !after.includes(rule))).toEqual([]);
  });

  it("removing one entry removes only that entry's own blocks", () => {
    const before = rules(renderFontsCss(FONT_REGISTRY));
    const after = rules(renderFontsCss(FONT_REGISTRY.filter((entry) => entry.key !== "inter")));
    const removed = before.filter((rule) => !after.includes(rule));
    expect(removed).toEqual([
      '@font-face { font-family: "Inter"; font-style: normal; font-weight: 400;' +
        ' font-display: swap; src: url("./fonts/inter-400.woff2") format("woff2"); }',
      ':root.font-inter { --font-portal: "Inter", ui-sans-serif, system-ui, -apple-system,' +
        ' "Segoe UI", Roboto, sans-serif; }',
    ]);
    expect(after.filter((rule) => !before.includes(rule))).toEqual([]);
  });

  it("removing every webfont still renders a usable stylesheet with System in it", () => {
    const systemOnly = renderFontsCss(FONT_REGISTRY.filter((e) => e.faces.length === 0));
    expect(systemOnly).not.toContain("@font-face");
    expect(systemOnly).toContain(":root.font-system");
  });
});

describe("tabular figures are token-driven (task 052 deliverable)", () => {
  const COMPONENTS_CSS = readFileSync(join(SRC, "theme-components.css"), "utf8");

  it("theme.css declares --type-numeric as tnum", () => {
    expect(firstDeclaration(THEME_CSS, "--type-numeric")).toBe('"tnum"');
  });

  it("theme-components.css applies it to numeric controls through the token", () => {
    expect(COMPONENTS_CSS).toContain("font-feature-settings: var(--type-numeric);");
    // The rule anchors on qcms/react-aria markup, never a vendored Tailwind class.
    const rule = rules(COMPONENTS_CSS).find((candidate) =>
      candidate.includes("font-feature-settings: var(--type-numeric);"),
    );
    expect(rule, "no rule applies --type-numeric").toBeDefined();
    expect(rule).toContain("[data-qcms-field]");
    expect(rule).toContain('[role="spinbutton"]');
  });
});
