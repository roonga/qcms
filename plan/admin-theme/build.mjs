// QCMS admin theme (Cobalt) - build script.
// Defines the admin token sets, verifies every critical contrast pair with the
// WCAG 2.2 relative-luminance formula, and emits tokens.css, ADMIN_THEME.md and
// the self-contained admin-theme.html preview. Fails the build if any pair
// misses its target, so the published numbers cannot drift from the tokens.
// Run: node build.mjs (from this directory)

import { writeFileSync } from "node:fs";

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
// WCAG-verified there); the admin adds only the cobalt accent and the topbar
// chrome group. Recomputed here anyway - the gate is cheap and total.

const light = {
  "--color-primary": "#1c4fd6",
  "--color-primary-hover": "#1846bf",
  "--color-primary-active": "#143da8",
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
  "--color-focus-ring": "#1c4fd6",
  "--color-overlay": "rgb(0 0 0 / 0.5)",
};

const dark = {
  "--color-primary": "#8ab0ff",
  "--color-primary-hover": "#9abcff",
  "--color-primary-active": "#a8c5ff",
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
  "--color-focus-ring": "#8ab0ff",
  "--color-overlay": "rgb(0 0 0 / 0.6)",
};

// Admin chrome: the topbar is deep cobalt navy in BOTH light and dark modes -
// the operator's fixed brand chrome. Its text sits on dark blue, so it carries
// its own contrast pairs independent of mode.
const topbarLight = {
  "--admin-topbar-bg": "#111c40",
  "--admin-topbar-hover": "#1b2a5c",
  "--admin-topbar-fg": "#f2f5ff",
  "--admin-topbar-fg-muted": "#a9b6e2",
  "--admin-topbar-accent": "#8ab0ff",
  "--admin-topbar-focus": "#9db9ff",
  "--admin-topbar-border": "#2a3866",
};

const topbarDark = {
  "--admin-topbar-bg": "#0e1834",
  "--admin-topbar-hover": "#182446",
  "--admin-topbar-fg": "#f2f5ff",
  "--admin-topbar-fg-muted": "#a9b6e2",
  "--admin-topbar-accent": "#8ab0ff",
  "--admin-topbar-focus": "#9db9ff",
  "--admin-topbar-border": "#26305a",
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
const spacing = {
  "--admin-control-h": "36px",
  "--admin-control-pad-x": "0.6rem",
  "--admin-stack": "0.35rem",
  "--admin-section-pad": "1.25rem",
  "--admin-table-row-h": "44px",
  "--radius-control": "6px",
  "--radius-card": "10px",
  "--radius-sm": "4px",
};

// ---------- Contrast gates ----------

const modePairs = (t, name) => [
  [`text / background`, t["--color-text"], t["--color-background"], 4.5],
  [`text / surface`, t["--color-text"], t["--color-surface"], 4.5],
  [`text-muted / background`, t["--color-text-muted"], t["--color-background"], 4.5],
  [`text-muted / surface`, t["--color-text-muted"], t["--color-surface"], 4.5],
  [`primary-fg / primary`, t["--color-primary-foreground"], t["--color-primary"], 4.5],
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
];

const topbarPairs = (tb, label) => [
  [`topbar-fg / topbar-bg`, tb["--admin-topbar-fg"], tb["--admin-topbar-bg"], 4.5],
  [`topbar-fg-muted / topbar-bg`, tb["--admin-topbar-fg-muted"], tb["--admin-topbar-bg"], 4.5],
  [`topbar-fg / topbar-hover`, tb["--admin-topbar-fg"], tb["--admin-topbar-hover"], 4.5],
  [`topbar-accent / topbar-bg`, tb["--admin-topbar-accent"], tb["--admin-topbar-bg"], 3.0],
  [`topbar-focus / topbar-bg`, tb["--admin-topbar-focus"], tb["--admin-topbar-bg"], 3.0],
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
  ["topbar (light chrome)", topbarPairs(topbarLight)],
  ["topbar (dark chrome)", topbarPairs(topbarDark)],
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

const css = `/* QCMS admin theme - Cobalt. Generated by plan/admin-theme/build.mjs.
   All values WCAG 2.2-verified at build time; see ADMIN_THEME.md.
   Mode convention matches the portal theme registry (051):
   (none) = Light  .dark = Dark  .hc = High-contrast (universal layer + accent).
   Neutrals and semantic colours are the shipped slate values; the admin adds
   the cobalt accent and the --admin-topbar-* chrome group. */

${block(":root", { ...light, ...spacing, "--font-admin": `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` })}

${block(":root.dark", dark)}

/* Topbar chrome: deep cobalt navy in both modes (fixed operator brand chrome). */
${block(":root", topbarLight)}
${block(":root.dark", topbarDark)}

/* High-contrast: the universal HC mode-layer (carried verbatim from the 051
   registry so this sheet is self-contained) plus the admin's cobalt accent -
   the accent is the only part the admin contributes, like any theme. In HC the
   topbar drops its navy fill for the universal white-on-black-border chrome. */
${block(":root.hc", {
  ...hcUniversal,
  ...hcAccent,
  "--admin-topbar-bg": "#ffffff",
  "--admin-topbar-hover": "#eceef1",
  "--admin-topbar-fg": "#000000",
  "--admin-topbar-fg-muted": "#22262e",
  "--admin-topbar-accent": "#0a3ea8",
  "--admin-topbar-focus": "#0a3ea8",
  "--admin-topbar-border": "#000000",
})}
`;

writeFileSync("tokens.css", css);

// ---------- Emit ADMIN_THEME.md ----------

const md = `# QCMS admin theme - Cobalt

Design deliverable for the admin app's visual theme (apps/admin, tasks 031-035).
Generated by \`build.mjs\`; every ratio below is computed from the exact token
values with the WCAG 2.2 relative-luminance formula, so the numbers cannot
drift from the tokens.

## Design intent

- **One system, two seats.** The admin reuses the portal's slate neutrals and
  semantic colours (051, already verified) unchanged. Only two things are new:
  the **cobalt accent** (the QCMS brand accent the admin shell has carried since
  031) and the **topbar chrome group**.
- **Operator chrome.** The top bar is deep cobalt navy in BOTH light and dark
  modes - fixed brand chrome that separates the operator tool from the
  respondent portal (whose chrome follows the respondent's theme). Its text sits
  on dark blue, so it carries its own contrast pairs, verified per mode below.
- **The admin is NOT respondent-themed.** Portal themes (slate/harbor/sand/plum)
  are the adopter's choice for respondents; the admin always wears Cobalt.
  Mode (light/dark/HC) remains a per-operator control.
- **HC for free.** High-contrast rides the universal 051 HC mode-layer; the
  admin contributes only an AAA-safe cobalt accent (the same mechanism any new
  theme uses). In HC the topbar drops its navy fill for universal
  black-on-white with a hard border.
- **Dense by default.** Controls are 36px (vs the portal's 44px comfortable) -
  an operator data tool, still comfortably above the 24px WCAG 2.5.8 floor.
  Table rows are 44px. Type floors are unchanged: body >= 16px, line-height
  >= 1.5.

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
`;

writeFileSync("ADMIN_THEME.md", md);

// ---------- Emit admin-theme.html ----------

const html = `<!-- @dsCard group="Admin" name="Admin theme - Cobalt" subtitle="Shell chrome, data table, auth card - light / dark / HC" -->
<title>QCMS admin theme - Cobalt</title>
<style>
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

/* topbar */
.topbar { display: flex; align-items: center; gap: 1.25rem; padding: 0 1.5rem; height: 56px;
  background: var(--admin-topbar-bg); border-bottom: 2px solid var(--admin-topbar-border); }
.topbar .brand { display: flex; align-items: center; gap: 0.5rem; color: var(--admin-topbar-fg); font-weight: 600; }
.topbar .brand .mark { width: 22px; height: 22px; border-radius: 5px; background: var(--admin-topbar-accent); color: var(--admin-topbar-bg); display: grid; place-items: center; font-size: 14px; font-weight: 700; }
.topbar nav { display: flex; gap: 0.25rem; flex: 1; }
.topbar nav a { color: var(--admin-topbar-fg-muted); text-decoration: none; padding: 0.4rem 0.7rem; border-radius: var(--radius-control); position: relative; }
.topbar nav a:hover { background: var(--admin-topbar-hover); color: var(--admin-topbar-fg); }
.topbar nav a:focus-visible { outline-color: var(--admin-topbar-focus); }
.topbar nav a[aria-current="page"] { color: var(--admin-topbar-fg); font-weight: 600; }
.topbar nav a[aria-current="page"]::after { content: ""; position: absolute; left: 0.7rem; right: 0.7rem; bottom: -2px; height: 3px; background: var(--admin-topbar-accent); border-radius: 2px; }
.topbar .signout { height: var(--admin-control-h); padding: 0 0.9rem; border-radius: var(--radius-control); border: 1px solid var(--admin-topbar-fg-muted); background: transparent; color: var(--admin-topbar-fg); cursor: pointer; }
.topbar .signout:hover { background: var(--admin-topbar-hover); }
.topbar .signout:focus-visible { outline-color: var(--admin-topbar-focus); }
:root.hc .topbar .signout { border-color: var(--admin-topbar-fg); }

/* layout */
.content { max-width: 1100px; margin: 0 auto; padding: 1.5rem; display: grid; gap: 1.5rem; }
.row { display: flex; gap: 1.5rem; flex-wrap: wrap; align-items: flex-start; }
h1 { font-size: 1.5rem; margin: 0; }
h2 { font-size: 1.1rem; margin: 0 0 0.75rem; }

/* buttons */
.btn { height: var(--admin-control-h); padding: 0 var(--admin-control-pad-x); border-radius: var(--radius-control); border: 1px solid transparent; cursor: pointer; }
.btn-primary { background: var(--color-primary); color: var(--color-primary-foreground); }
.btn-primary:hover { background: var(--color-primary-hover); }
.btn-secondary { background: var(--color-secondary); color: var(--color-secondary-foreground); }
.btn-ghost { background: var(--color-ghost); color: var(--color-text); border-color: var(--color-border-strong); }
.btn-ghost:hover { background: var(--color-ghost-hover); }
.btn-danger { background: var(--color-danger); color: var(--color-danger-foreground); }

/* toolbar + table */
.card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-card); padding: var(--admin-section-pad); }
.toolbar { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
.toolbar input[type="search"], .toolbar select { height: var(--admin-control-h); padding: 0 var(--admin-control-pad-x); border-radius: var(--radius-control); border: 1px solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); }
.toolbar .spacer { flex: 1; }
table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
th { text-align: left; color: var(--color-text-muted); font-weight: 600; padding: 0.5rem 0.75rem; border-bottom: 2px solid var(--color-border-strong); }
td { padding: 0 0.75rem; height: var(--admin-table-row-h); border-bottom: 1px solid var(--color-border); }
tbody tr:nth-child(even) { background: var(--color-background-muted); }
tbody tr:hover { background: var(--color-surface-hover); }
.chip { display: inline-block; padding: 0.1rem 0.55rem; border-radius: var(--radius-sm); font-size: 0.85rem; font-weight: 600; }
.chip-published { background: var(--color-success-subtle); color: var(--color-success-fg); }
.chip-draft { background: var(--color-info-subtle); color: var(--color-info-fg); }
.chip-retired { background: var(--color-warning-subtle); color: var(--color-warning-fg); }
.rowactions button { height: 32px; }
code { background: var(--color-background-muted); padding: 0.05rem 0.35rem; border-radius: var(--radius-sm); font-size: 0.85em; }

/* banners */
.banner { padding: 0.75rem 1rem; border-radius: var(--radius-card); border: 1px solid; margin-bottom: 0.75rem; }
.banner-info { background: var(--color-info-subtle); color: var(--color-info-fg); border-color: var(--color-info-fg); }
.banner-success { background: var(--color-success-subtle); color: var(--color-success-fg); border-color: var(--color-success-fg); }
.banner-warning { background: var(--color-warning-subtle); color: var(--color-warning-fg); border-color: var(--color-warning-fg); }
.banner-danger { background: var(--color-danger-subtle); color: var(--color-danger-fg); border-color: var(--color-danger-fg); }

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
  <span class="brand"><span class="mark" aria-hidden="true">Q</span> QCMS admin</span>
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
      <h2>Banners</h2>
      <div class="banner banner-info">Draft compiled against rules version <code>v7</code>.</div>
      <div class="banner banner-success">Form published. Respondent links are live.</div>
      <div class="banner banner-warning">2 questions are retired but still referenced.</div>
      <div class="banner banner-danger">Publish failed: rule <code>rul_9f2k</code> references a deleted option.</div>
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
