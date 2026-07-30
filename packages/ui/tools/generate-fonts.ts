/**
 * Writes the two artifacts derived from the font manifest (task 052):
 * `src/fonts.css` and `src/fonts/NOTICE.md`.
 *
 *   pnpm --filter @qcms/ui fonts:generate
 *
 * The manifest (`src/font-registry.ts`) is the single place a font is added or
 * removed. Both outputs are committed - the portal `@import`s the stylesheet with
 * no build step and no network, and the notice is what a redistributor reads - and
 * `src/font-registry.test.ts` fails if either has drifted from the manifest. That
 * pairing is what makes add/remove a ONE-ENTRY change rather than an edit in three
 * places.
 *
 * Lives outside `src/` on purpose: `src/import-surface.test.ts` allows only the
 * a2-react-aria stack in the shipped tree, and this tool needs `node:fs`.
 *
 * The package script pipes both outputs through Prettier, because the repo's root
 * `lint` includes `prettier --check .` and Prettier reflows a long
 * custom-property value onto a continuation line. The CSS drift test therefore
 * compares content with whitespace normalized: formatting is Prettier's business,
 * content is the manifest's.
 */

import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { FONT_GROUPS, FONT_REGISTRY, renderFontsCss } from "../src/font-registry.ts";
import type { FontEntry } from "../src/font-registry.ts";

const SRC = join(import.meta.dirname, "..", "src");
const FONT_DIR = join(SRC, "fonts");

/**
 * Total committed bytes of one entry's self-hosted faces, counting each FILE once.
 * A variable font (Lexend) declares two faces over one file, and counting per face
 * would report bytes that are not on disk.
 */
function bytesOf(entry: FontEntry): number {
  const files = new Set(entry.faces.map((face) => face.file));
  return [...files].reduce((total, file) => total + statSync(join(FONT_DIR, file)).size, 0);
}

const thousands = (n: number): string => n.toLocaleString("en-US");

/** The fixed preamble: what a redistributor needs to know before the tables. */
const PREAMBLE: readonly string[] = [
  "# Self-hosted font notices (`@qcms/ui`)",
  "",
  "Generated from `src/font-registry.ts` by `pnpm --filter @qcms/ui fonts:generate`.",
  "",
  "Every typeface QCMS ships is open-licensed and redistributable under QCMS's MIT",
  "terms, and every binary in this directory is committed to the repository: a portal",
  "serves fonts from its own origin and makes **zero external requests** for a",
  "typeface. There is no CDN and no build-time download, so nothing here can make a",
  "deployment or CI depend on a third-party host.",
  "",
  "The license texts the notices below refer to sit beside the binaries, which is what",
  "OFL-1.1 (section 2) and Apache-2.0 (section 4a) each require of a redistribution:",
  "`LICENSE-OFL-1.1.txt` and `LICENSE-Apache-2.0.txt`.",
  "",
  "The files are the **Latin** `woff2` subsets, so text outside Latin falls back",
  "glyph-by-glyph through each entry's fallback stack. A designed multi-script",
  "fallback baseline is issue #27 and is not covered here.",
  "",
];

/** One entry's summary row. */
function summaryRow(entry: FontEntry): string {
  const weights = entry.faces.map((face) => face.weight).join(", ");
  return (
    `| ${entry.label} | \`${entry.key}\` | ${weights === "" ? "none" : weights} |` +
    ` ${entry.license ?? "n/a (no webfont)"} | ${thousands(bytesOf(entry))} |`
  );
}

/** One entry's copyright notice, or nothing when there is no webfont to cover. */
function noticeBlock(entry: FontEntry): readonly string[] {
  if (entry.copyright === null) return [];
  return [`**${entry.label}** (${entry.license})`, "", `> ${entry.copyright}`, ""];
}

/** One group: its summary table, then a notice block per entry. */
function groupSection(group: string, entries: readonly FontEntry[]): readonly string[] {
  return [
    `## ${group}`,
    "",
    "| Family | Key | Weights | License | Bytes |",
    "| --- | --- | --- | --- | --- |",
    ...entries.map(summaryRow),
    "",
    ...entries.flatMap(noticeBlock),
  ];
}

/**
 * The redistribution notice. OFL-1.1 section 2 and Apache-2.0 section 4(a) each
 * require the license text and the copyright notice to travel with the bytes, so
 * this file plus the two `LICENSE-*.txt` files beside the binaries are what
 * discharges that obligation for a QCMS deployment.
 */
function renderNotice(): string {
  const sections = FONT_GROUPS.flatMap((group) => {
    const inGroup = FONT_REGISTRY.filter((entry) => entry.group === group);
    return inGroup.length === 0 ? [] : groupSection(group, inGroup);
  });
  const files = new Set(FONT_REGISTRY.flatMap((entry) => entry.faces.map((face) => face.file)));
  const faces = FONT_REGISTRY.reduce((count, entry) => count + entry.faces.length, 0);
  const total = FONT_REGISTRY.reduce((sum, entry) => sum + bytesOf(entry), 0);
  return [
    ...PREAMBLE,
    ...sections,
    `Total committed font payload: **${thousands(total)} bytes** across ` +
      `${thousands(files.size)} files (${thousands(faces)} declared faces; a variable font's ` +
      `weights share one file).`,
    "",
  ].join("\n");
}

writeFileSync(join(SRC, "fonts.css"), renderFontsCss(), "utf8");
writeFileSync(join(FONT_DIR, "NOTICE.md"), renderNotice(), "utf8");
console.log(`fonts: wrote fonts.css and fonts/NOTICE.md from ${FONT_REGISTRY.length} entries`);
