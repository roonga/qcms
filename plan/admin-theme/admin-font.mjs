// Shared helper: embeds the QCMS app's two faces - Inter for UI text and
// JetBrains Mono for ids, hashes, versions and data values (Code Owner,
// 2026-10-24, issue #1121, SigPilot foundations) - as self-hosted, base64
// @font-face rules for the design-doc HTML files in this directory. Reads the
// product's own already-vendored assets: no new dependency, no CDN, no re-fetch.
// The paths are derived from this file's own location (repo root is two levels
// up from plan/admin-theme/) so nothing machine-specific ends up in committed
// content.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FACES = [
  { family: "Inter", file: "inter-variable.woff2" },
  { family: "JetBrains Mono", file: "jetbrainsmono-variable.woff2" },
];

/**
 * Returns self-contained @font-face rules embedding the product's two variable
 * woff2 files (OFL-1.1, recorded in packages/ui/src/fonts/NOTICE.md). Variable
 * weight (100 900) on each, so the 600 titles and labels use the real instance
 * rather than a synthesized one.
 */
export function adminFontFaceCss() {
  return FACES.map(({ family, file }) => {
    const base64 = readFileSync(
      fileURLToPath(new URL(`../../packages/ui/src/fonts/${file}`, import.meta.url)),
    ).toString("base64");
    return `@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;font-display:swap;src:url(data:font/woff2;base64,${base64}) format('woff2');}`;
  }).join("\n");
}
