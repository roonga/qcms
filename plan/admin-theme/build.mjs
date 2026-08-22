// QCMS admin theme (Cobalt) - build script. Rev 2: aligned to the QCMS Design
// System visual language (qcms-design-system.html in the Claude Design project):
// brand cobalt #2456C6 / #7AA2FF, mode-following translucent topbar, 8px radius
// base, tight heading tracking. Rev 1's fixed navy topbar and off-brand cobalt
// (#1c4fd6) were divergences and are withdrawn.
// Defines the admin token sets, verifies every critical contrast pair with the
// WCAG 2.2 relative-luminance formula, and emits tokens.css, ADMIN_THEME.md and
// the self-contained admin-theme.html preview. Fails the build if any pair
// misses, so the published numbers cannot drift from the tokens.
// Run: node build.mjs (from this directory)

import { writeFileSync } from "node:fs";
import { lexendFontFaceCss } from "./lexend-font.mjs";

// ---------- WCAG math ----------

const lin = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (fg, bg) => {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
};

// ---------- Tokens ----------
// Neutrals and semantic colours are the shipped slate values (051, already
// WCAG-verified there). The accent is the design-system cobalt: #2456C6 light /
// #7AA2FF dark (the values the DS overview and the portal focus ring already
// use), so primary == focus-ring == info hue, as in the DS (--ring == --primary).

const light = {
  "--color-primary": "#2456c6",
  "--color-primary-hover": "#1e4aad",
  "--color-primary-active": "#193f95",
  "--color-primary-foreground": "#ffffff",
  "--color-secondary": "#4f5b70",
  "--color-secondary-hover": "#475265",
  "--color-secondary-active": "#3f495a",
  "--color-secondary-foreground": "#ffffff",
  "--color-danger": "#c0271f",
  "--color-danger-hover": "#ad231c",
  "--color-danger-active": "#9a1f19",
  "--color-danger-foreground": "#ffffff",
  "--color-danger-subtle": "#f9e7e5",
  "--color-danger-fg": "#8f1d18",
  "--color-ghost": "transparent",
  "--color-ghost-hover": "#eef1f6",
  "--color-ghost-active": "#e4e8ef",
  "--color-info": "#2456c6",
  "--color-info-subtle": "#e9effb",
  "--color-info-fg": "#1b44a0",
  "--color-success": "#1e7a46",
  "--color-success-subtle": "#e4f1ea",
  "--color-success-fg": "#16603a",
  "--color-warning": "#8a5a00",
  "--color-warning-subtle": "#f6eeda",
  "--color-warning-fg": "#6e4700",
  "--color-text": "#0f1729",
  "--color-text-muted": "#55617a",
  "--color-border": "#dde2ea",
  "--color-border-strong": "#838ca4",
  "--color-background": "#fbfcfd",
  "--color-background-muted": "#eef1f6",
  "--color-surface": "#ffffff",
  "--color-surface-hover": "#f4f6fa",
  "--color-focus-ring": "#2456c6",
  "--color-overlay": "rgb(0 0 0 / 0.5)",
  "--shadow-color": "222deg 30% 20%",
};

const dark = {
  "--color-primary": "#7aa2ff",
  "--color-primary-hover": "#8fb1ff",
  "--color-primary-active": "#a1beff",
  "--color-primary-foreground": "#0b0f1a",
  "--color-secondary": "#97a2b8",
  "--color-secondary-hover": "#a3adc1",
  "--color-secondary-active": "#aeb6c8",
  "--color-secondary-foreground": "#0b0f1a",
  "--color-danger": "#ff7b80",
  "--color-danger-hover": "#ff8b8f",
  "--color-danger-active": "#ff989c",
  "--color-danger-foreground": "#0b0f1a",
  "--color-danger-subtle": "#2b1615",
  "--color-danger-fg": "#ffb3b5",
  "--color-ghost": "transparent",
  "--color-ghost-hover": "#1b2230",
  "--color-ghost-active": "#232c3c",
  "--color-info": "#7aa2ff",
  "--color-info-subtle": "#16233a",
  "--color-info-fg": "#a9c4ff",
  "--color-success": "#46c08a",
  "--color-success-subtle": "#132a20",
  "--color-success-fg": "#8fe0bd",
  "--color-warning": "#e0a93b",
  "--color-warning-subtle": "#2a2110",
  "--color-warning-fg": "#f0cd85",
  "--color-text": "#e6eaf2",
  "--color-text-muted": "#97a2b8",
  "--color-border": "#262e3d",
  "--color-border-strong": "#626c88",
  "--color-background": "#0b0f1a",
  "--color-background-muted": "#10151f",
  "--color-surface": "#141a26",
  "--color-surface-hover": "#1b2230",
  "--color-focus-ring": "#7aa2ff",
  "--color-overlay": "rgb(0 0 0 / 0.6)",
  "--shadow-color": "222deg 60% 2%",
};

// HC: the universal 051 HC mode-layer (carried verbatim from the portal theme
// registry so this sheet is self-contained), plus the admin's cobalt accent -
// the only part the admin actually contributes.
const hcUniversal = {
  "--color-secondary": "#1c2433",
  "--color-secondary-hover": "#19202e",
  "--color-secondary-active": "#161d29",
  "--color-secondary-foreground": "#ffffff",
  "--color-danger": "#8a0f0a",
  "--color-danger-hover": "#7c0e09",
  "--color-danger-active": "#6e0c08",
  "--color-danger-foreground": "#ffffff",
  "--color-danger-subtle": "#ffecea",
  "--color-danger-fg": "#6b0b07",
  "--color-ghost": "transparent",
  "--color-ghost-hover": "#eceef1",
  "--color-ghost-active": "#dfe2e7",
  "--color-info": "#0a3ea8",
  "--color-info-subtle": "#e6efff",
  "--color-info-fg": "#08337d",
  "--color-success": "#0a5c30",
  "--color-success-subtle": "#e2f4e9",
  "--color-success-fg": "#064023",
  "--color-warning": "#5a3b00",
  "--color-warning-subtle": "#fbf0d6",
  "--color-warning-fg": "#4a3000",
  "--color-text": "#000000",
  "--color-text-muted": "#22262e",
  "--color-border": "#5a616e",
  "--color-border-strong": "#000000",
  "--color-background": "#ffffff",
  "--color-background-muted": "#f2f3f5",
  "--color-surface": "#ffffff",
  "--color-surface-hover": "#eceef1",
  "--color-focus-ring": "#0a3ea8",
  "--color-overlay": "rgb(0 0 0 / 0.7)",
};

const hcAccent = {
  "--color-primary": "#0a3ea8",
  "--color-primary-hover": "#08348f",
  "--color-primary-active": "#062a75",
  "--color-primary-foreground": "#ffffff",
};

// Admin density default: dense chrome (36px controls; WCAG 2.5.8 floor is 24px).
// Radius (rev 4): sharper, more industrial than the DS 8px base - control 4px,
// card 8px, small 2px. A deliberate admin-level divergence; see ADMIN_THEME.md.
const spacing = {
  "--admin-control-h": "40px",
  "--admin-control-pad-x": "0.6rem",
  "--admin-stack": "0.35rem",
  "--admin-section-pad": "1.25rem",
  "--admin-table-row-h": "44px",
  "--radius-control": "4px",
  "--radius-card": "8px",
  "--radius-sm": "2px",
};

// ---------- Contrast gates ----------

const modePairs = (t) => [
  [`text / background`, t["--color-text"], t["--color-background"], 4.5],
  [`text / surface`, t["--color-text"], t["--color-surface"], 4.5],
  [`text-muted / background`, t["--color-text-muted"], t["--color-background"], 4.5],
  [`text-muted / surface`, t["--color-text-muted"], t["--color-surface"], 4.5],
  [`primary-fg / primary`, t["--color-primary-foreground"], t["--color-primary"], 4.5],
  [`primary-fg / primary-hover`, t["--color-primary-foreground"], t["--color-primary-hover"], 4.5],
  [`primary-fg / primary-active`, t["--color-primary-foreground"], t["--color-primary-active"], 4.5],
  [`secondary-fg / secondary`, t["--color-secondary-foreground"], t["--color-secondary"], 4.5],
  [`danger-fg-btn / danger`, t["--color-danger-foreground"], t["--color-danger"], 4.5],
  [`danger-fg / danger-subtle`, t["--color-danger-fg"], t["--color-danger-subtle"], 4.5],
  [`info-fg / info-subtle`, t["--color-info-fg"], t["--color-info-subtle"], 4.5],
  [`success-fg / success-subtle`, t["--color-success-fg"], t["--color-success-subtle"], 4.5],
  [`warning-fg / warning-subtle`, t["--color-warning-fg"], t["--color-warning-subtle"], 4.5],
  [`border-strong / surface`, t["--color-border-strong"], t["--color-surface"], 3.0],
  [`border-strong / background`, t["--color-border-strong"], t["--color-background"], 3.0],
  [`focus-ring / background`, t["--color-focus-ring"], t["--color-background"], 3.0],
  [`focus-ring / surface`, t["--color-focus-ring"], t["--color-surface"], 3.0],
  [`primary / surface (link-UI)`, t["--color-primary"], t["--color-surface"], 3.0],
  [`primary / background (topbar active)`, t["--color-primary"], t["--color-background"], 3.0],
];

const hc = { ...hcUniversal, ...hcAccent };
const hcPairs = [
  [`text / background (AAA)`, hc["--color-text"], hc["--color-background"], 7.0],
  [`text-muted / background (AAA)`, hc["--color-text-muted"], hc["--color-background"], 7.0],
  [`primary-fg / primary (AAA)`, hc["--color-primary-foreground"], hc["--color-primary"], 7.0],
  [`secondary-fg / secondary (AAA)`, hc["--color-secondary-foreground"], hc["--color-secondary"], 7.0],
  [`danger-fg-btn / danger (AAA)`, hc["--color-danger-foreground"], hc["--color-danger"], 7.0],
  [`danger-fg / danger-subtle (AAA)`, hc["--color-danger-fg"], hc["--color-danger-subtle"], 7.0],
  [`info-fg / info-subtle (AAA)`, hc["--color-info-fg"], hc["--color-info-subtle"], 7.0],
  [`success-fg / success-subtle (AAA)`, hc["--color-success-fg"], hc["--color-success-subtle"], 7.0],
  [`warning-fg / warning-subtle (AAA)`, hc["--color-warning-fg"], hc["--color-warning-subtle"], 7.0],
  [`border-strong / surface`, hc["--color-border-strong"], hc["--color-surface"], 3.0],
  [`focus-ring / background`, hc["--color-focus-ring"], hc["--color-background"], 3.0],
  [`primary / white surface`, hc["--color-primary"], hc["--color-surface"], 3.0],
];

const sections = [
  ["cobalt / light", modePairs(light)],
  ["cobalt / dark", modePairs(dark)],
  ["cobalt / high-contrast (universal layer + cobalt accent)", hcPairs],
];

let failed = 0;
const tables = sections.map(([name, pairs]) => {
  const rows = pairs.map(([pair, fg, bg, target]) => {
    const r = ratio(fg, bg);
    const pass = r >= target;
    if (!pass) {
      failed++;
      console.error(`FAIL ${name}: ${pair} ${fg} on ${bg} = ${r.toFixed(2)} (target ${target})`);
    }
    return `| ${pair} | \`${fg}\` | \`${bg}\` | ${r.toFixed(2)} | ${target} | ${pass ? "PASS" : "FAIL"} |`;
  });
  return `### ${name}\n\n| Pair | Foreground | Background | Ratio | Target | Result |\n|---|---|---|---:|---:|:--:|\n${rows.join("\n")}`;
});

if (failed > 0) {
  console.error(`${failed} contrast pair(s) failed - not emitting artifacts.`);
  process.exit(1);
}
console.log("All contrast pairs pass.");

// ---------- Emit tokens.css ----------

const block = (sel, obj) =>
  `${sel} {\n${Object.entries(obj).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`;

/** Indent a whole block by one level, for nesting it inside an at-rule. */
const indent = (text) => text.split("\n").map((line) => `  ${line}`).join("\n");

const css = `/* QCMS app theme - Cobalt (rev 2, aligned to the QCMS Design System).
   Generated by plan/admin-theme/build.mjs. All values WCAG 2.2-verified at
   build time; see ADMIN_THEME.md.
   Mode convention matches the portal theme registry (051):
   (none) = Light  .dark = Dark  .hc = High-contrast (universal layer + accent).
   Neutrals and semantic colours are the shipped slate values; the accent is the
   design-system cobalt (#2456C6 / #7AA2FF; primary == focus-ring == info hue,
   as the DS overview's --ring == --primary). The topbar is translucent and
   mode-following (styled from standard tokens; no dedicated chrome group). */

${block(":root", { ...light, ...spacing, "--font-admin": `"Lexend", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`, "--font-mono": `ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", Consolas, monospace` })}

${block(":root.dark", dark)}

/* Auto: with no mode class on the root, the sheet follows the operating system.
   This is what makes "no explicit choice" resolve to the machine's preference
   with no script and no flash - the server can stamp a class only when the
   operator has chosen one, and this block covers the case where it cannot.
   Dark is the ONLY inferred mode: there is deliberately no prefers-contrast
   companion, because .hc is only ever an explicit choice.
   :not(.light) is what makes an explicit Light choice stick on a
   dark-preferring machine. Light is the bare :root block above, so the
   light class carries no values of its own and exists only to opt out here. */
@media (prefers-color-scheme: dark) {
${indent(block(":root:not(.light):not(.dark):not(.hc)", dark))}
}

/* High-contrast: the universal HC mode-layer (carried verbatim from the 051
   registry so this sheet is self-contained) plus the QCMS app's cobalt accent -
   the accent is the only part the QCMS app contributes, like any theme. */
${block(":root.hc", { ...hcUniversal, ...hcAccent })}
`;

writeFileSync("tokens.css", css);

// ---------- Emit ADMIN_THEME.md ----------

const md = `# QCMS app theme - Cobalt (rev 2)

Design deliverable for the QCMS app's visual theme (apps/admin, tasks 031-035).
Generated by \`build.mjs\`; every ratio below is computed from the exact token
values with the WCAG 2.2 relative-luminance formula, so the numbers cannot
drift from the tokens.

**Rev 6 (2026-07-31, task 055):** the sheet gained an auto block - a
\`prefers-color-scheme: dark\` layer that applies the Dark values when the root
carries no mode class at all. That is what lets the shipped app default to the
operator's machine preference with no pre-paint script (the QCMS app's CSP grants
no inline script of its own) and no flash: the server stamps a class only for an
explicit choice, and this block covers the rest. High-contrast is never inferred,
so there is no \`prefers-contrast\` companion. Landed at
\`apps/admin/app/theme.css\`, kept byte-identical to this copy by
\`scripts/check-admin-theme.mjs\`.

**Rev 5 (2026-07-30):** Lexend is the QCMS app face (Code Owner pick from the
six-candidate comparison). No new dependency: the app consumes the registry's
already-vendored \`lexend-variable.woff2\` (OFL-1.1, recorded in
packages/ui/src/fonts/NOTICE.md). System stack remains the @font-face fallback
only. Operators get no font switcher.

**Rev 4 (2026-07-30):** sharper industrial corners (Code Owner direction):
radius-control 4px, radius-card 8px, radius-sm 2px; buttons and chips squared
(chips keep the status dot). This is the Corners brand-character axis from the
portal theme system applied at the QCMS app level: the QCMS app wears sharp, the
portal keeps Subtle.

**Rev 3 (2026-07-30):** component pass - adopted the DS overview's existing
component language that rev 2 under-used: layered soft card shadows on a
\`--shadow-color\` token, weight-600 flex buttons with hover/active states,
alert anatomy (icon slot, subtle surface, colour-mix softened border), pill
chips (mono, colour dot), uppercase table headers, controls at 40px (between
the DS portal 48px and the old dense 36px; floor is 24px). A gap list of
components the DS still needs (button state matrix, input family, alert
severity family, data table, overlays) is with the Code Owner.

**Rev 2 (2026-07-30):** aligned to the QCMS Design System visual language
(\`qcms-design-system.html\` in the Claude Design project) after the Code Owner
flagged rev 1's divergence. Changed: accent is now the brand cobalt
(#2456C6 light / #7AA2FF dark, the DS primary and the portal focus-ring value)
instead of rev 1's #1c4fd6; the fixed navy topbar is withdrawn in favour of the
DS's translucent, mode-following topbar (the QCMS app's identity comes from the wordmark
and density, not divergent chrome); radius follows the DS 8px base; headings
carry the DS tight tracking.

## Design intent

- **One system, two surfaces.** The QCMS app reuses the portal's slate neutrals and
  semantic colours (051, already verified) unchanged, and takes its accent and
  chrome language from the design system overview. There are two deliberate
  divergences: Corners and Typeface. Corners: the DS overview and the portal's
  Subtle theme use an 8px radius base, but the QCMS app (rev 4) sharpens to a
  4px/8px/2px (control/card/small) industrial scale - an intentional
  app-level brand-character choice, not drift. Typeface: the QCMS app ships
  Lexend (rev 5, Code Owner pick) as its one face, with no operator switcher;
  the DS overview and the portal both start from the plain system stack.
  Everything else in this theme is the DS applied to the QCMS app, unchanged.
- **Topbar:** translucent surface over the page (\`color-mix\` 88% background +
  blur), hairline border, wordmark (\`QCMS\` mark only, no sub-label), active nav
  item in primary with an accent underline. Follows mode like every other
  region. In HC the translucency is dropped: solid surface, strong border, no
  blur.
- **The QCMS app is NOT respondent-themed.** Portal themes (slate/harbor/sand/plum)
  are the adopter's choice for respondents; it always wears the brand
  cobalt. Mode (light/dark/HC) remains a per-operator control.
- **HC for free.** High-contrast rides the universal 051 HC mode-layer; the
  QCMS app contributes only an AAA-safe cobalt accent (the same mechanism any new
  theme uses).
- **Dense by default.** Controls are 40px (vs the portal's 44px comfortable and
  the DS overview's 48px portal scale) - an operator data tool, still
  comfortably above the 24px WCAG 2.5.8 floor.
  Table rows are 44px; numeric table cells use tabular figures. Type floors are
  unchanged: body >= 16px, line-height >= 1.5.

## Targets

| Mode | Body text | Large / secondary | UI / borders / focus |
|---|---|---|---|
| Light | 4.5:1 (AA) | 3:1 | 3:1 |
| Dark | 4.5:1 (AA) | 3:1 | 3:1 |
| High-contrast | 7:1 (AAA) | 4.5:1 | 3:1 |

## Verified contrast pairs

${tables.join("\n\n")}

## Files

- \`tokens.css\` - the generated token sheet (same selector convention as the
  portal registry: bare \`:root\` = light, \`.dark\`, \`.hc\`).
- \`admin-theme.html\` - self-contained preview (shell + question library table +
  auth card + banners) with a light/dark/HC switcher; pushed to the
  "QCMS Design System" Claude Design project as \`admin/theme.html\`.

## Known adjacent staleness (not this deliverable)

The DS overview's neutral values predate 051 and differ slightly from the
landed registry (e.g. dark card #121826 vs 051's #141a26). The 051 registry is
the product truth; the overview should be regenerated from it at some point.
`;

writeFileSync("ADMIN_THEME.md", md);

// ---------- Emit admin-theme.html ----------

const html = `<!-- @dsCard group="QCMS" name="QCMS app theme - Cobalt" subtitle="Shell chrome, data table, auth card - light / dark / HC" -->
<title>QCMS app theme - Cobalt</title>
<style>
${lexendFontFaceCss()}
${css}
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--font-admin); font-size: 16px; line-height: 1.5;
  color: var(--color-text); background: var(--color-background); }
button, input, select { font: inherit; }
:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }

/* switcher (preview chrome, not part of the design) */
.switcher { display: flex; gap: 0.5rem; padding: 0.75rem 1.5rem; border-bottom: 1px dashed var(--color-border-strong); background: var(--color-background-muted); }
.switcher button { height: 32px; padding: 0 0.75rem; border-radius: var(--radius-control); border: 1px solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); cursor: pointer; }
.switcher button[aria-pressed="true"] { background: var(--color-primary); border-color: var(--color-primary); color: var(--color-primary-foreground); }

/* topbar: translucent, mode-following (DS language) */
.topbar { position: sticky; top: 0; display: flex; align-items: center; gap: 1.25rem; padding: 0 1.5rem; height: 60px;
  background: color-mix(in srgb, var(--color-background) 88%, transparent);
  backdrop-filter: saturate(1.2) blur(8px);
  border-bottom: 1px solid var(--color-border); }
:root.hc .topbar { background: var(--color-surface); backdrop-filter: none; border-bottom: 2px solid var(--color-border-strong); }
.topbar .brand { display: flex; align-items: baseline; gap: 0.5rem; }
.topbar .brand .mark { font-weight: 800; letter-spacing: -0.02em; color: var(--color-text); }
.topbar .brand .sub { font-size: 0.85rem; color: var(--color-text-muted); }
.topbar nav { display: flex; gap: 0.25rem; flex: 1; }
.topbar nav a { color: var(--color-text-muted); text-decoration: none; padding: 0.4rem 0.7rem; border-radius: var(--radius-control); position: relative; }
.topbar nav a:hover { background: var(--color-ghost-hover); color: var(--color-text); }
.topbar nav a[aria-current="page"] { color: var(--color-primary); font-weight: 600; }
.topbar nav a[aria-current="page"]::after { content: ""; position: absolute; left: 0.7rem; right: 0.7rem; bottom: -1px; height: 2px; background: var(--color-primary); border-radius: 2px; }
.topbar .signout { height: var(--admin-control-h); padding: 0 0.9rem; border-radius: var(--radius-control); border: 1px solid var(--color-border-strong); background: var(--color-ghost); color: var(--color-text); cursor: pointer; }
.topbar .signout:hover { background: var(--color-ghost-hover); }

/* layout */
.content { max-width: 1100px; margin: 0 auto; padding: 1.5rem; display: grid; gap: 1.5rem; }
.row { display: flex; gap: 1.5rem; flex-wrap: wrap; align-items: flex-start; }
h1 { font-size: 1.7rem; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
h2 { font-size: 1.1rem; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 0.75rem; }

/* buttons (DS language: weight 600, generous padding, soft radius, icon-ready flex) */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  height: var(--admin-control-h); padding: 0 18px; border-radius: var(--radius-control);
  border: 1.5px solid transparent; font-weight: 600; font-size: 0.95rem; cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease; }
.btn-primary { background: var(--color-primary); color: var(--color-primary-foreground); }
.btn-primary:hover { background: var(--color-primary-hover); }
.btn-primary:active { background: var(--color-primary-active); }
.btn-secondary { background: var(--color-secondary); color: var(--color-secondary-foreground); }
.btn-secondary:hover { background: var(--color-secondary-hover); }
.btn-ghost { background: var(--color-surface); color: var(--color-text); border-color: var(--color-border-strong); }
.btn-ghost:hover { background: var(--color-ghost-hover); }
.btn-danger { background: var(--color-danger); color: var(--color-danger-foreground); }
.btn-danger:hover { background: var(--color-danger-hover); }

/* toolbar + table */
.card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-card); padding: var(--admin-section-pad);
  box-shadow: 0 1px 2px hsl(var(--shadow-color) / 0.06), 0 12px 40px -12px hsl(var(--shadow-color) / 0.18); }
:root.hc .card { box-shadow: none; }
.toolbar { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
.toolbar input[type="search"], .toolbar select { height: var(--admin-control-h); padding: 0 var(--admin-control-pad-x); border-radius: var(--radius-control); border: 1px solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); }
.toolbar .spacer { flex: 1; }
table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
th { text-align: left; color: var(--color-text-muted); font-weight: 600; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; padding: 0.5rem 0.75rem; border-bottom: 2px solid var(--color-border-strong); }
td { padding: 0 0.75rem; height: var(--admin-table-row-h); border-bottom: 1px solid var(--color-border); font-variant-numeric: tabular-nums; }
tbody tr:nth-child(even) { background: var(--color-background-muted); }
tbody tr:hover { background: var(--color-surface-hover); }
/* chips (DS language: squared, mono, colour dot, softened border) */
.chip { display: inline-flex; align-items: center; gap: 7px; padding: 4px 11px; border-radius: var(--radius-control);
  font-family: var(--font-mono); font-size: 12px; font-weight: 600;
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent); }
.chip::before { content: ""; width: 8px; height: 8px; border-radius: 2px; background: currentColor; }
.chip-published { background: var(--color-success-subtle); color: var(--color-success-fg); }
.chip-draft { background: var(--color-info-subtle); color: var(--color-info-fg); }
.chip-retired { background: var(--color-warning-subtle); color: var(--color-warning-fg); }
.rowactions button { height: 32px; }
code { background: var(--color-background-muted); padding: 0.05rem 0.35rem; border-radius: var(--radius-sm); font-size: 0.85em; }

/* alerts (DS language: icon slot, subtle surface, colour-mix softened border) */
.banner { display: flex; gap: 11px; align-items: flex-start; padding: 12px 14px; border-radius: var(--radius-card);
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent); margin-bottom: 0.75rem; }
.banner svg { width: 16px; height: 16px; flex-shrink: 0; margin-top: 3px; }
.banner-info { background: var(--color-info-subtle); color: var(--color-info-fg); }
.banner-success { background: var(--color-success-subtle); color: var(--color-success-fg); }
.banner-warning { background: var(--color-warning-subtle); color: var(--color-warning-fg); }
.banner-danger { background: var(--color-danger-subtle); color: var(--color-danger-fg); }

/* auth card */
.auth { max-width: 380px; }
.auth label { display: block; margin-bottom: var(--admin-stack); font-weight: 600; }
.auth input { width: 100%; height: var(--admin-control-h); padding: 0 var(--admin-control-pad-x); border-radius: var(--radius-control); border: 1px solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); margin-bottom: 1rem; }
</style>

<div class="switcher" role="group" aria-label="Preview mode">
  <button aria-pressed="true" onclick="setMode('', this)">Light</button>
  <button aria-pressed="false" onclick="setMode('dark', this)">Dark</button>
  <button aria-pressed="false" onclick="setMode('hc', this)">High-contrast</button>
</div>

<header class="topbar">
  <span class="brand"><span class="mark">QCMS</span></span>
  <nav aria-label="Primary">
    <a href="#" aria-current="page">Questions</a>
    <a href="#">Forms</a>
    <a href="#">Responses</a>
    <a href="#">Webhooks</a>
    <a href="#">Settings</a>
  </nav>
  <button class="signout">Sign out</button>
</header>

<main class="content">
  <h1>Questions</h1>

  <div class="card">
    <div class="toolbar">
      <input type="search" placeholder="Search questions" aria-label="Search questions">
      <select aria-label="Filter by type"><option>All types</option><option>Text</option><option>Single choice</option></select>
      <span class="spacer"></span>
      <button class="btn btn-primary">New question</button>
    </div>
    <table>
      <thead><tr><th>Question</th><th>Type</th><th>Status</th><th>Updated</th><th></th></tr></thead>
      <tbody>
        <tr><td>Full name</td><td>Text</td><td><span class="chip chip-published">Published</span></td><td>2026-07-28</td><td class="rowactions"><button class="btn btn-ghost">Edit</button></td></tr>
        <tr><td>Vehicle registration state</td><td>Single choice</td><td><span class="chip chip-published">Published</span></td><td>2026-07-27</td><td class="rowactions"><button class="btn btn-ghost">Edit</button></td></tr>
        <tr><td>Prior insurance claims</td><td>Multi choice</td><td><span class="chip chip-draft">Draft</span></td><td>2026-07-26</td><td class="rowactions"><button class="btn btn-ghost">Edit</button></td></tr>
        <tr><td>Policy start date</td><td>Date</td><td><span class="chip chip-published">Published</span></td><td>2026-07-24</td><td class="rowactions"><button class="btn btn-ghost">Edit</button></td></tr>
        <tr><td>Annual mileage</td><td>Number</td><td><span class="chip chip-retired">Retired</span></td><td>2026-07-19</td><td class="rowactions"><button class="btn btn-ghost">Edit</button></td></tr>
        <tr><td>Garage postcode</td><td>Text</td><td><span class="chip chip-draft">Draft</span></td><td>2026-07-18</td><td class="rowactions"><button class="btn btn-ghost">Edit</button></td></tr>
      </tbody>
    </table>
  </div>

  <div class="row">
    <div class="card" style="flex: 1 1 380px;">
      <h2>Alerts</h2>
      <div class="banner banner-info">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="10" x2="12" y2="17"/><circle cx="12" cy="7" r="0.5" fill="currentColor"/></svg>
        <span>Draft compiled against rules version <code>v7</code>.</span>
      </div>
      <div class="banner banner-success">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.5 2.5L16 9"/></svg>
        <span>Form published. Respondent links are live.</span>
      </div>
      <div class="banner banner-warning">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3L2 20h20L12 3z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>
        <span>2 questions are retired but still referenced.</span>
      </div>
      <div class="banner banner-danger">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/></svg>
        <span>Publish failed: rule <code>rul_9f2k</code> references a deleted option.</span>
      </div>
    </div>

    <div class="card auth" style="flex: 0 1 380px;">
      <h2>Sign in</h2>
      <label for="em">Email</label>
      <input id="em" type="email" autocomplete="username">
      <label for="pw">Password</label>
      <input id="pw" type="password" autocomplete="current-password">
      <button class="btn btn-primary" style="width: 100%;">Sign in</button>
    </div>

    <div class="card" style="flex: 1 1 300px;">
      <h2>Buttons</h2>
      <p style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 0;">
        <button class="btn btn-primary">Primary</button>
        <button class="btn btn-secondary">Secondary</button>
        <button class="btn btn-ghost">Ghost</button>
        <button class="btn btn-danger">Danger</button>
      </p>
    </div>
  </div>
</main>

<script>
function setMode(mode, btn) {
  document.documentElement.className = mode;
  document.querySelectorAll(".switcher button").forEach((b) => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
}
</script>
`;

writeFileSync("admin-theme.html", html);
console.log("Emitted tokens.css, ADMIN_THEME.md, admin-theme.html");
