// QCMS Design System - first-pass component cards (PO draft for Code Owner
// redline). Emits six self-contained cards consuming the generated admin
// token sheet (tokens.css, built by build.mjs - run that first). Five cover
// a gap named in component-gaps.html: buttons (state matrix), inputs
// (family + error anatomy), alerts (severity family), data table, overlays.
// The sixth, navbar, documents the admin topbar (canonical treatment carried
// over from admin-theme.html) plus the portal respondent header for contrast.
// Run: node components.mjs (from this directory)

import { readFileSync, writeFileSync } from "node:fs";
import { lexendFontFaceCss } from "./lexend-font.mjs";

const tokens = readFileSync("tokens.css", "utf8");
const lexendFontFace = lexendFontFaceCss();

const BASE = `
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--font-admin); font-size: 16px; line-height: 1.5;
  color: var(--color-text); background: var(--color-background); }
button, input, select, textarea { font: inherit; }
:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
.switcher { display: flex; gap: 0.5rem; padding: 0.75rem 1.5rem; border-bottom: 1px dashed var(--color-border-strong); background: var(--color-background-muted); }
.switcher button { height: 32px; padding: 0 0.75rem; border-radius: var(--radius-control); border: 1px solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); cursor: pointer; }
.switcher button[aria-pressed="true"] { background: var(--color-primary); border-color: var(--color-primary); color: var(--color-primary-foreground); }
.content { max-width: 1000px; margin: 0 auto; padding: 1.5rem; display: grid; gap: 1.5rem; }
h1 { font-size: 1.7rem; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
h2 { font-size: 1.1rem; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 0.75rem; }
h3 { font-size: 0.95rem; font-weight: 600; margin: 1rem 0 0.5rem; color: var(--color-text-muted); }
.card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-card); padding: 1.25rem;
  box-shadow: 0 1px 2px hsl(var(--shadow-color) / 0.06), 0 12px 40px -12px hsl(var(--shadow-color) / 0.18); }
:root.hc .card { box-shadow: none; }
.note { font-size: 0.85rem; color: var(--color-text-muted); }
.rowline { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  height: 40px; padding: 0 18px; border-radius: var(--radius-control);
  border: 1.5px solid transparent; font-weight: 600; font-size: 0.95rem; cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease; }
.btn-primary { background: var(--color-primary); color: var(--color-primary-foreground); }
.btn-primary:hover, .btn-primary.is-hover { background: var(--color-primary-hover); }
.btn-primary:active, .btn-primary.is-active { background: var(--color-primary-active); }
.btn-secondary { background: var(--color-secondary); color: var(--color-secondary-foreground); }
.btn-secondary:hover, .btn-secondary.is-hover { background: var(--color-secondary-hover); }
.btn-secondary:active, .btn-secondary.is-active { background: var(--color-secondary-active); }
.btn-ghost { background: var(--color-surface), transparent; background: var(--color-surface); color: var(--color-text); border-color: var(--color-border-strong); }
.btn-ghost:hover, .btn-ghost.is-hover { background: var(--color-ghost-hover); }
.btn-ghost:active, .btn-ghost.is-active { background: var(--color-ghost-active); }
.btn-danger { background: var(--color-danger); color: var(--color-danger-foreground); }
.btn-danger:hover, .btn-danger.is-hover { background: var(--color-danger-hover); }
.btn-danger:active, .btn-danger.is-active { background: var(--color-danger-active); }
.btn.is-focus { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-sm { height: 32px; padding: 0 12px; font-size: 0.875rem; border-radius: var(--radius-control); }
/* btn-lg keeps a 6px literal rather than the 4px --radius-control: at 48px
   height (the portal/respondent scale) 4px reads as a sharp corner clipping a
   tall pill; 6px keeps the industrial edge without looking accidental. */
.btn-lg { height: 48px; padding: 0 20px; border-radius: 6px; }
.btn-icon { width: 40px; padding: 0; }
.spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid currentColor; border-top-color: transparent; animation: rot 0.8s linear infinite; }
@keyframes rot { to { transform: rotate(360deg); } }

.field { max-width: 380px; margin-bottom: 1rem; }
.field label { display: block; font-size: 0.95rem; font-weight: 600; margin-bottom: 6px; }
.field .req { color: var(--color-danger-fg); }
.field .hint { font-size: 0.85rem; color: var(--color-text-muted); margin: 0 0 6px; }
.field input, .field select, .field textarea { width: 100%; height: 40px; padding: 0 12px; border-radius: var(--radius-control);
  border: 1px solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text);
  transition: border-color 0.12s ease; }
.field textarea { height: auto; min-height: 90px; padding: 8px 12px; }
.field input:hover, .field select:hover, .field textarea:hover { border-color: var(--color-text-muted); }
.field input.is-focus { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
.field.is-error input, .field.is-error textarea { border-color: var(--color-danger); border-width: 1.5px; }
.field .error { display: flex; gap: 6px; align-items: center; font-size: 0.85rem; color: var(--color-danger-fg); margin-top: 6px; font-weight: 600; }
.field .error svg { width: 14px; height: 14px; flex-shrink: 0; }
.field input:disabled { background: var(--color-background-muted); color: var(--color-text-muted); cursor: not-allowed; }
.field input[readonly] { background: var(--color-background-muted); }
.search { position: relative; }
.search svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: var(--color-text-muted); }
.search input { padding-left: 34px; }

.banner { display: flex; gap: 11px; align-items: flex-start; padding: 12px 14px; border-radius: var(--radius-card);
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent); margin-bottom: 0.75rem; }
.banner svg { width: 16px; height: 16px; flex-shrink: 0; margin-top: 3px; }
.banner .body { flex: 1; }
.banner .close { background: none; border: none; color: inherit; cursor: pointer; padding: 2px; line-height: 1; font-size: 1.1rem; }
.banner-info { background: var(--color-info-subtle); color: var(--color-info-fg); }
.banner-success { background: var(--color-success-subtle); color: var(--color-success-fg); }
.banner-warning { background: var(--color-warning-subtle); color: var(--color-warning-fg); }
.banner-danger { background: var(--color-danger-subtle); color: var(--color-danger-fg); }

table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
th { text-align: left; color: var(--color-text-muted); font-weight: 600; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; padding: 0.5rem 0.75rem; border-bottom: 2px solid var(--color-border-strong); }
td { padding: 0 0.75rem; height: 44px; border-bottom: 1px solid var(--color-border); font-variant-numeric: tabular-nums; }
tbody tr:nth-child(even) { background: var(--color-background-muted); }
tbody tr:hover { background: var(--color-surface-hover); }
code { background: var(--color-background-muted); padding: 0.05rem 0.35rem; border-radius: var(--radius-sm); font-size: 0.85em; }
`;

const ICONS = {
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="10" x2="12" y2="17"/><circle cx="12" cy="7" r="0.5" fill="currentColor"/></svg>`,
  success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.5 2.5L16 9"/></svg>`,
  warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3L2 20h20L12 3z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>`,
  danger: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16" y1="16" x2="21" y2="21"/></svg>`,
  plus: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
};

const SWITCHER = `
<div class="switcher" role="group" aria-label="Preview mode">
  <button aria-pressed="true" onclick="setMode('', this)">Light</button>
  <button aria-pressed="false" onclick="setMode('dark', this)">Dark</button>
  <button aria-pressed="false" onclick="setMode('hc', this)">High-contrast</button>
</div>`;

const SCRIPT = `
<script>
function setMode(mode, btn) {
  document.documentElement.className = mode;
  document.querySelectorAll(".switcher button").forEach((b) => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
}
</script>`;

const page = (card, title, extraCss, body) =>
  `<!-- @dsCard group="Components" name="${card}" subtitle="${title}" -->
<title>QCMS DS - ${card}</title>
<style>
${lexendFontFace}
${tokens}
${BASE}
${extraCss}
</style>
${SWITCHER}
<main class="content">
${body}
</main>
${SCRIPT}
`;

// ---------- buttons ----------

const stateCell = (variant, cls, label) =>
  `<td><button class="btn ${variant} ${cls}"${cls === "is-disabled" ? " disabled" : ""}>${cls === "is-loading" ? `<span class="spin" aria-hidden="true"></span> ` : ""}${label}</button></td>`;

const buttonRow = (name, variant) => {
  const cells = [
    ["", "Rest"],
    ["is-hover", "Hover"],
    ["is-active", "Active"],
    ["is-focus", "Focus"],
    ["is-disabled", "Disabled"],
    ["is-loading", "Loading"],
  ].map(([cls]) => stateCell(variant, cls, name));
  return `<tr><th scope="row" style="text-transform: none; letter-spacing: 0; font-size: 0.9rem;">${name}</th>${cells.join("")}</tr>`;
};

const buttonsBody = `
<h1>Buttons</h1>
<p class="note">State matrix (hover/active/focus simulated with classes so every state is visible at once), sizes, and the density axis. Disabled is 50% opacity + not-allowed; loading keeps the label beside a spinner and stays interactive-looking but inert.</p>
<div class="card">
  <h2>Variants x states</h2>
  <table>
    <thead><tr><th></th><th>Rest</th><th>Hover</th><th>Active</th><th>Focus</th><th>Disabled</th><th>Loading</th></tr></thead>
    <tbody style="--admin-table-row-h: 56px;">
      ${buttonRow("Primary", "btn-primary")}
      ${buttonRow("Secondary", "btn-secondary")}
      ${buttonRow("Ghost", "btn-ghost")}
      ${buttonRow("Danger", "btn-danger")}
    </tbody>
  </table>
</div>
<div class="card">
  <h2>Sizes and density</h2>
  <h3>Portal scale (48px) - respondent-facing</h3>
  <p class="rowline"><button class="btn btn-lg btn-primary">Continue</button><button class="btn btn-lg btn-ghost">Back</button></p>
  <h3>QCMS app scale (40px) - default in the QCMS app</h3>
  <p class="rowline"><button class="btn btn-primary">${ICONS.plus} New question</button><button class="btn btn-ghost">Cancel</button></p>
  <h3>Small (32px) - table row actions</h3>
  <p class="rowline"><button class="btn btn-sm btn-ghost">Edit</button><button class="btn btn-sm btn-ghost">Duplicate</button></p>
  <h3>Icon-only (40px, needs aria-label)</h3>
  <p class="rowline"><button class="btn btn-icon btn-ghost" aria-label="Add">${ICONS.plus}</button></p>
</div>`;

// ---------- inputs ----------

const inputsBody = `
<h1>Inputs</h1>
<p class="note">Field anatomy: label (+ required marker), optional hint, control, error message with icon. Error styling feeds task 048 (author validation messages); the page-level error summary pairs with field-level errors.</p>
<div class="card">
  <h2>Anatomy and states (text field)</h2>
  <div class="rowline" style="align-items: flex-start;">
    <div class="field"><label>Default</label><input type="text" value="Toyota Corolla"></div>
    <div class="field"><label>Focus</label><input type="text" class="is-focus" value="Toyota Corolla"></div>
    <div class="field is-error"><label>Error <span class="req" aria-hidden="true">*</span></label><input type="text" value="" aria-invalid="true"><p class="error">${ICONS.danger} Vehicle make is required.</p></div>
    <div class="field"><label>Disabled</label><input type="text" value="Locked after submit" disabled></div>
    <div class="field"><label>Readonly</label><input type="text" value="ses_8f2ka91m" readonly></div>
  </div>
</div>
<div class="card">
  <h2>The family</h2>
  <div class="rowline" style="align-items: flex-start;">
    <div class="field"><label>Search</label><div class="search">${ICONS.search}<input type="search" placeholder="Search questions"></div></div>
    <div class="field"><label>Select</label><select><option>Single choice</option><option>Multi choice</option><option>Text</option></select></div>
    <div class="field"><label>Date</label><input type="date" value="2026-07-30"></div>
    <div class="field" style="min-width: 300px;"><label>Textarea</label><p class="hint">Shown to the respondent under the question label.</p><textarea>Any prior claims in the last 5 years?</textarea></div>
  </div>
</div>
<div class="card">
  <h2>Page-level error summary</h2>
  <div class="banner banner-danger" role="alert">
    ${ICONS.danger}
    <div class="body"><strong>2 answers need attention</strong>
      <ul style="margin: 6px 0 0; padding-left: 1.2rem;">
        <li><a href="#" style="color: inherit;">Vehicle make is required.</a></li>
        <li><a href="#" style="color: inherit;">Policy start date must be in the future.</a></li>
      </ul>
    </div>
  </div>
</div>`;

// ---------- alerts ----------

const alert = (sev, body, extra = "") =>
  `<div class="banner banner-${sev}">${ICONS[sev]}<div class="body">${body}</div>${extra}</div>`;

const alertsBody = `
<h1>Alerts</h1>
<p class="note">One anatomy (icon slot, subtle surface, colour-mix softened border), four severities, three variants. Toast is the same anatomy elevated on a shadow, bottom-right, transient.</p>
<div class="card">
  <h2>Severity family</h2>
  ${alert("info", "Draft compiled against rules version <code>v7</code>.")}
  ${alert("success", "Form published. Respondent links are live.")}
  ${alert("warning", "2 questions are retired but still referenced.")}
  ${alert("danger", "Publish failed: rule <code>rul_9f2k</code> references a deleted option.")}
</div>
<div class="card">
  <h2>Variants</h2>
  <h3>Dismissible</h3>
  ${alert("info", "A newer draft of this form exists.", `<button class="close" aria-label="Dismiss">&times;</button>`)}
  <h3>With action</h3>
  ${alert("warning", `<strong>Unsaved changes.</strong> Your edits to this question are not saved.`, `<button class="btn btn-sm btn-ghost" style="border-color: currentColor; color: inherit; background: transparent;">Save now</button>`)}
  <h3>Toast (transient, elevated)</h3>
  <div style="max-width: 360px;">
    <div class="banner banner-success" style="box-shadow: 0 2px 4px hsl(var(--shadow-color) / 0.15), 0 30px 60px -24px hsl(var(--shadow-color) / 0.5); background: var(--color-surface); border-color: var(--color-border);">
      ${ICONS.success}<div class="body" style="color: var(--color-text);">Question saved.</div><button class="close" aria-label="Dismiss" style="color: var(--color-text-muted);">&times;</button>
    </div>
  </div>
</div>`;

// ---------- table ----------

const tableBody = `
<h1>Data table</h1>
<p class="note">Sortable headers (active column carries the arrow), selectable rows, hover, pagination, empty state, loading skeleton. 44px rows, tabular figures in numeric columns.</p>
<div class="card">
  <h2>Standard</h2>
  <table>
    <thead><tr>
      <th style="width: 36px;"><input type="checkbox" aria-label="Select all" style="width: 16px; height: 16px;"></th>
      <th aria-sort="ascending"><a href="#" style="color: inherit; text-decoration: none;">Question &#9650;</a></th>
      <th><a href="#" style="color: inherit; text-decoration: none;">Type</a></th>
      <th><a href="#" style="color: inherit; text-decoration: none;">Updated</a></th>
      <th></th>
    </tr></thead>
    <tbody>
      <tr style="background: var(--color-info-subtle);"><td><input type="checkbox" checked aria-label="Select row" style="width: 16px; height: 16px;"></td><td>Annual mileage</td><td>Number</td><td>2026-07-19</td><td><button class="btn btn-sm btn-ghost">Edit</button></td></tr>
      <tr><td><input type="checkbox" aria-label="Select row" style="width: 16px; height: 16px;"></td><td>Full name</td><td>Text</td><td>2026-07-28</td><td><button class="btn btn-sm btn-ghost">Edit</button></td></tr>
      <tr><td><input type="checkbox" aria-label="Select row" style="width: 16px; height: 16px;"></td><td>Policy start date</td><td>Date</td><td>2026-07-24</td><td><button class="btn btn-sm btn-ghost">Edit</button></td></tr>
    </tbody>
  </table>
  <div class="rowline" style="justify-content: space-between; margin-top: 0.75rem;">
    <span class="note">1 of 3 selected</span>
    <span class="rowline">
      <button class="btn btn-sm btn-ghost" disabled>Previous</button>
      <span class="note" style="font-variant-numeric: tabular-nums;">Page 1 of 12</span>
      <button class="btn btn-sm btn-ghost">Next</button>
    </span>
  </div>
</div>
<div class="card">
  <h2>Empty state</h2>
  <div style="border: 1.5px dashed var(--color-border-strong); border-radius: var(--radius-card); padding: 2.5rem; text-align: center;">
    <p style="margin: 0 0 0.25rem; font-weight: 600;">No questions yet</p>
    <p class="note" style="margin: 0 0 1rem;">Questions you create appear here and can be reused across forms.</p>
    <button class="btn btn-primary">${ICONS.plus} New question</button>
  </div>
</div>
<div class="card">
  <h2>Loading skeleton</h2>
  <table aria-hidden="true">
    <thead><tr><th>Question</th><th>Type</th><th>Updated</th></tr></thead>
    <tbody>
      <tr><td><span class="sk" style="width: 60%;"></span></td><td><span class="sk" style="width: 40%;"></span></td><td><span class="sk" style="width: 50%;"></span></td></tr>
      <tr><td><span class="sk" style="width: 45%;"></span></td><td><span class="sk" style="width: 55%;"></span></td><td><span class="sk" style="width: 50%;"></span></td></tr>
      <tr><td><span class="sk" style="width: 70%;"></span></td><td><span class="sk" style="width: 35%;"></span></td><td><span class="sk" style="width: 50%;"></span></td></tr>
    </tbody>
  </table>
</div>`;

const tableCss = `
.sk { display: inline-block; height: 0.9em; border-radius: var(--radius-sm); background: linear-gradient(90deg, var(--color-background-muted), var(--color-border), var(--color-background-muted)); background-size: 200% 100%; animation: shimmer 1.4s ease infinite; }
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
`;

// ---------- overlays ----------

const overlaysBody = `
<h1>Overlays and navigation</h1>
<p class="note">Confirm dialog (destructive variant shown - retire/erase flows), dropdown menu, tabs, breadcrumb. Dialogs trap focus; the destructive confirm names the object and the consequence, and the safe action is the default.</p>
<div class="card">
  <h2>Destructive confirm dialog</h2>
  <div style="position: relative; height: 300px; border-radius: var(--radius-card); overflow: hidden; background: var(--color-overlay);">
    <div role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" style="position: absolute; inset: 0; display: grid; place-items: center;">
      <div class="card" style="max-width: 420px; box-shadow: 0 2px 4px hsl(var(--shadow-color) / 0.15), 0 30px 60px -24px hsl(var(--shadow-color) / 0.5);">
        <h2 id="dlg-t">Retire this question?</h2>
        <p style="margin: 0 0 1.25rem;">Retiring <strong>Annual mileage</strong> removes it from new forms. Published forms that reference it keep working; historical answers are never deleted.</p>
        <div class="rowline" style="justify-content: flex-end;">
          <button class="btn btn-ghost">Cancel</button>
          <button class="btn btn-danger">Retire question</button>
        </div>
      </div>
    </div>
  </div>
</div>
<div class="card">
  <h2>Dropdown menu (open)</h2>
  <div style="position: relative; height: 210px;">
    <button class="btn btn-ghost" aria-expanded="true">Actions &#9662;</button>
    <div role="menu" style="position: absolute; top: 46px; left: 0; min-width: 200px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-card); padding: 6px; box-shadow: 0 2px 4px hsl(var(--shadow-color) / 0.1), 0 30px 70px -30px hsl(var(--shadow-color) / 0.4);">
      <a role="menuitem" href="#" class="mi">Edit</a>
      <a role="menuitem" href="#" class="mi">Duplicate</a>
      <a role="menuitem" href="#" class="mi" style="background: var(--color-surface-hover);">Preview</a>
      <div style="height: 1px; background: var(--color-border); margin: 6px 4px;"></div>
      <a role="menuitem" href="#" class="mi" style="color: var(--color-danger-fg);">Retire</a>
    </div>
  </div>
</div>
<div class="card">
  <h2>Tabs</h2>
  <div role="tablist" style="display: flex; gap: 0.25rem; border-bottom: 1px solid var(--color-border);">
    <button role="tab" aria-selected="true" class="tab tab-on">Details</button>
    <button role="tab" aria-selected="false" class="tab">Rules</button>
    <button role="tab" aria-selected="false" class="tab">History</button>
  </div>
  <p class="note" style="margin-top: 0.75rem;">Active tab: primary text + 2px primary underline, same treatment as the topbar's active nav item.</p>
</div>
<div class="card">
  <h2>Breadcrumb</h2>
  <nav aria-label="Breadcrumb"><ol style="display: flex; gap: 0.5rem; list-style: none; margin: 0; padding: 0;">
    <li><a href="#" style="color: var(--color-text-muted);">Forms</a></li>
    <li aria-hidden="true" style="color: var(--color-text-muted);">/</li>
    <li><a href="#" style="color: var(--color-text-muted);">Vehicle insurance intake</a></li>
    <li aria-hidden="true" style="color: var(--color-text-muted);">/</li>
    <li aria-current="page" style="font-weight: 600;">Builder</li>
  </ol></nav>
</div>`;

const overlaysCss = `
.mi { display: block; padding: 8px 10px; border-radius: var(--radius-sm); color: var(--color-text); text-decoration: none; }
.mi:hover { background: var(--color-surface-hover); }
.tab { background: none; border: none; cursor: pointer; padding: 0.5rem 0.9rem; color: var(--color-text-muted); font-weight: 600; position: relative; }
.tab-on { color: var(--color-primary); }
.tab-on::after { content: ""; position: absolute; left: 0.9rem; right: 0.9rem; bottom: -1px; height: 2px; background: var(--color-primary); border-radius: 2px; }
`;

// ---------- navbar ----------
// Canonical admin topbar treatment carried over verbatim from
// admin-theme.html (translucent, mode-following, sticky) rather than
// re-derived, plus the quieter portal respondent header for contrast. The
// .navitem class factors admin-theme.html's ".topbar nav a" rules out so the
// same rules drive both the real topbar and the standalone states row below
// it. The high-contrast demo scopes the exact HC token values from
// tokens.css (":root.hc") onto a local wrapper class so it renders correctly
// independent of the page-level mode switcher above. The 390px demo relies
// on nothing but flexbox: nav shrinks (min-width: 0) and wraps onto further
// rows as its container narrows, no media query and no JS.

const navbarCss = `
.navitem { color: var(--color-text-muted); text-decoration: none; padding: 0.4rem 0.7rem; border-radius: var(--radius-control); position: relative; font-size: 0.95rem; }
.navitem:hover, .navitem.is-hover { background: var(--color-ghost-hover); color: var(--color-text); }
.navitem.is-focus { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
.navitem[aria-current="page"] { color: var(--color-primary); font-weight: 600; }
.navitem[aria-current="page"]::after { content: ""; position: absolute; left: 0.7rem; right: 0.7rem; bottom: -1px; height: 2px; background: var(--color-primary); border-radius: 2px; }

.topbar { position: sticky; top: 0; display: flex; align-items: center; gap: 1.25rem; padding: 0.6rem 1.5rem; min-height: 60px;
  background: color-mix(in srgb, var(--color-background) 88%, transparent);
  backdrop-filter: saturate(1.2) blur(8px);
  border-bottom: 1px solid var(--color-border);
  flex-wrap: wrap; }
:root.hc .topbar { background: var(--color-surface); backdrop-filter: none; border-bottom: 2px solid var(--color-border-strong); }
.topbar .brand { display: flex; align-items: baseline; gap: 0.5rem; }
.topbar .brand .mark { font-weight: 800; letter-spacing: -0.02em; color: var(--color-text); }
.topbar .brand .sub { font-size: 0.85rem; color: var(--color-text-muted); }
.topbar nav { display: flex; gap: 0.25rem; flex: 1 1 160px; min-width: 0; flex-wrap: wrap; }
.topbar .signout { height: var(--admin-control-h); padding: 0 0.9rem; border-radius: var(--radius-control); border: 1px solid var(--color-border-strong); background: var(--color-ghost); color: var(--color-text); cursor: pointer; flex-shrink: 0; }
.topbar .signout:hover { background: var(--color-ghost-hover); }

.frame { border: 1px solid var(--color-border); border-radius: var(--radius-card); overflow: hidden; }
.demo-fill { padding: 0.85rem 1.5rem; color: var(--color-text-muted); font-size: 0.85rem; background: var(--color-background); }

/* High-contrast treatment demo: the exact universal HC mode-layer values
   plus the QCMS app's cobalt accent (tokens.css ":root.hc"), scoped to this box
   so it renders correctly regardless of the page-level switcher above. */
.demo-hc { --color-ghost-hover: #eceef1; --color-text: #000000; --color-text-muted: #22262e;
  --color-border: #5a616e; --color-border-strong: #000000; --color-background: #ffffff;
  --color-surface: #ffffff; --color-focus-ring: #0a3ea8; --color-primary: #0a3ea8; }
.demo-hc .topbar { background: var(--color-surface); backdrop-filter: none; border-bottom: 2px solid var(--color-border-strong); }

.portal-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.75rem 1.5rem;
  background: var(--color-surface); border-bottom: 1px solid var(--color-border); }
.portal-header .brandmark { display: flex; align-items: center; gap: 0.6rem; }
.portal-header .brandmark .swatch { width: 24px; height: 24px; border-radius: var(--radius-sm); background: var(--color-primary); flex-shrink: 0; }
.portal-header .brandmark .title { font-weight: 700; font-size: 1rem; }
.portal-header .controls { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.portal-header .controls select { height: 32px; padding: 0 0.5rem; border-radius: var(--radius-control); border: 1px solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); font-size: 0.85rem; }
`;

const topbarMarkup = `
    <header class="topbar">
      <span class="brand"><span class="mark">QCMS</span></span>
      <nav aria-label="Primary">
        <a href="#" class="navitem" aria-current="page">Questions</a>
        <a href="#" class="navitem">Forms</a>
        <a href="#" class="navitem">Responses</a>
        <a href="#" class="navitem">Webhooks</a>
        <a href="#" class="navitem">Settings</a>
      </nav>
      <button class="signout">Sign out</button>
    </header>`;

const navbarBody = `
<h1>Navbar</h1>
<p class="note">The QCMS topbar is fixed brand chrome: translucent, sticky, mode-following, never themed by the respondent (see 051). Below it: the state matrix, the high-contrast override, 390px wrap behaviour, and the quieter portal respondent header for comparison.</p>

<div class="card">
  <h2>QCMS topbar</h2>
  <div class="frame">${topbarMarkup}
    <div class="demo-fill">Page content scrolls under the bar.</div>
  </div>

  <h3>Nav item states</h3>
  <p class="note">Hover and focus-visible are simulated with classes so every state is visible at once; active carries primary text plus a 2px primary underline, driven by <code>aria-current="page"</code>.</p>
  <div class="rowline" style="background: var(--color-background); padding: 0.6rem 0.75rem; border-radius: var(--radius-control);">
    <a href="#" class="navitem">Rest</a>
    <a href="#" class="navitem is-hover">Hover</a>
    <a href="#" class="navitem is-focus">Focus-visible</a>
    <a href="#" class="navitem" aria-current="page">Active</a>
  </div>
</div>

<div class="card">
  <h2>High-contrast treatment</h2>
  <p class="note">HC drops the translucency: solid surface, no blur, 2px strong border (tokens.css ":root.hc"). Forced here with scoped tokens so it renders correctly on its own, independent of the page-level mode switcher above.</p>
  <div class="frame demo-hc">${topbarMarkup}
  </div>
</div>

<div class="card">
  <h2>Narrow viewport (390px)</h2>
  <p class="note">Pure CSS, no JS: as the container narrows the nav shrinks and wraps onto further rows, the bar grows to an auto height, and sign-out stays on the top row and reachable.</p>
  <div class="frame" style="width: 390px;">${topbarMarkup}
  </div>
</div>

<div class="card">
  <h2>Portal respondent header</h2>
  <p class="note">Portal chrome follows the respondent's theme; the QCMS bar above is fixed brand chrome regardless of theme.</p>
  <div class="frame">
    <header class="portal-header">
      <span class="brandmark"><span class="swatch" aria-hidden="true"></span><span class="title">Vehicle insurance intake</span></span>
      <div class="controls">
        <select aria-label="Mode"><option>Light</option><option>Dark</option><option>High contrast</option></select>
        <select aria-label="Font"><option>Default</option><option>Dyslexic-friendly</option><option>Large print</option></select>
        <select aria-label="Density"><option>Comfortable</option><option>Compact</option></select>
      </div>
    </header>
  </div>
</div>`;

// ---------- emit ----------

const cards = [
  ["ds-buttons.html", "Buttons", "Variants x states matrix, sizes, density axis", "", buttonsBody],
  ["ds-inputs.html", "Inputs", "Field family, states, error anatomy + summary", "", inputsBody],
  ["ds-alerts.html", "Alerts", "Severity family, dismissible, action, toast", "", alertsBody],
  [
    "ds-table.html",
    "Data table",
    "Sort, selection, pagination, empty, skeleton",
    tableCss,
    tableBody,
  ],
  [
    "ds-overlays.html",
    "Overlays",
    "Confirm dialog, dropdown, tabs, breadcrumb",
    overlaysCss,
    overlaysBody,
  ],
  ["ds-navbar.html", "Navbar", "QCMS topbar + portal header, states, 390px", navbarCss, navbarBody],
];

for (const [file, name, subtitle, extraCss, body] of cards) {
  writeFileSync(file, page(name, subtitle, extraCss, body));
}
console.log(`Emitted ${cards.length} component cards`);
