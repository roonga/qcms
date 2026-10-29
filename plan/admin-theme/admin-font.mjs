// Embeds the app's two faces as base64 @font-face rules, so the design-doc HTML in
// this directory is self-contained. Paths are derived from this file's own location,
// to keep anything machine-specific out of committed content.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FACES = [
  { family: "Inter", file: "inter-variable.woff2" },
  { family: "JetBrains Mono", file: "jetbrainsmono-variable.woff2" },
];

/**
 * The product's two vendored variable woff2 files (OFL-1.1, recorded in
 * packages/ui/src/fonts/NOTICE.md), declared over the whole 100-900 axis so a 600
 * title uses the real instance rather than a synthesized one.
 */
export function adminFontFaceCss() {
  return FACES.map(({ family, file }) => {
    const base64 = readFileSync(
      fileURLToPath(new URL(`../../packages/ui/src/fonts/${file}`, import.meta.url)),
    ).toString("base64");
    return `@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;font-display:swap;src:url(data:font/woff2;base64,${base64}) format('woff2');}`;
  }).join("\n");
}
