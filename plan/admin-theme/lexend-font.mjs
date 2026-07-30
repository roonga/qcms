// Shared helper: embeds the QCMS app's chosen typeface (Lexend, Code Owner
// pick from the six-candidate comparison in qcms-font-compare.html, 2026-07-30)
// as a self-hosted, base64 @font-face rule for the design-doc HTML files in
// this directory. Reads the product's own already-vendored asset - no new
// dependency, no CDN, no re-fetch. The path is derived from this file's own
// location (repo root is two levels up from plan/admin-theme/) so nothing
// machine-specific ends up in committed content.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LEXEND_WOFF2_PATH = fileURLToPath(
  new URL("../../packages/ui/src/fonts/lexend-variable.woff2", import.meta.url)
);

/**
 * Returns a self-contained @font-face rule embedding the product's Lexend
 * variable-weight woff2 (OFL-1.1, recorded in packages/ui/src/fonts/NOTICE.md)
 * as a base64 data URI. Variable weight (100 900) - one file, no separate
 * regular/bold declarations needed.
 */
export function lexendFontFaceCss() {
  const base64 = readFileSync(LEXEND_WOFF2_PATH).toString("base64");
  return `@font-face{font-family:'Lexend';font-style:normal;font-weight:100 900;font-display:swap;src:url(data:font/woff2;base64,${base64}) format('woff2');}`;
}
