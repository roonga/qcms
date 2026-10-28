/**
 * Writes `src/fonts.css` and `src/fonts/NOTICE.md` from the font manifest (`pnpm --filter @roonga/qcms-ui fonts:generate`).
 * Both outputs are committed, so the portal needs no build step or network. It lives outside `src/` because the
 * import-surface test allows only the a2-react-aria stack in the shipped tree and this needs `node:fs`.
 */

import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { FONT_GROUPS, FONT_REGISTRY, renderFontsCss } from "../src/font-registry.ts";
import type { FontEntry } from "../src/font-registry.ts";

const SRC = join(import.meta.dirname, "..", "src");
const FONT_DIR = join(SRC, "fonts");

// Each file once: a variable font declares several faces over one, so counting per
// face would report bytes that are not on disk.
function bytesOf(entry: FontEntry): number {
  const files = new Set(entry.faces.map((face) => face.file));
  return [...files].reduce((total, file) => total + statSync(join(FONT_DIR, file)).size, 0);
}

const thousands = (n: number): string => n.toLocaleString("en-US");

const PREAMBLE: readonly string[] = [
  "# Self-hosted font notices (`@roonga/qcms-ui`)",
  "",
  "Generated from `src/font-registry.ts` by `pnpm --filter @roonga/qcms-ui fonts:generate`.",
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

function summaryRow(entry: FontEntry): string {
  const weights = entry.faces.map((face) => face.weight).join(", ");
  return (
    `| ${entry.label} | \`${entry.key}\` | ${weights === "" ? "none" : weights} |` +
    ` ${entry.license ?? "n/a (no webfont)"} | ${thousands(bytesOf(entry))} |`
  );
}

function noticeBlock(entry: FontEntry): readonly string[] {
  if (entry.copyright === null) return [];
  return [`**${entry.label}** (${entry.license})`, "", `> ${entry.copyright}`, ""];
}

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
 * OFL-1.1 section 2 and Apache-2.0 section 4(a) each require the license text and the
 * copyright notice to travel with the bytes, so this output plus the two
 * `LICENSE-*.txt` files beside the binaries are what discharge that obligation.
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
