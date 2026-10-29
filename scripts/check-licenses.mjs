#!/usr/bin/env node
// @ts-check
/**
 * QCMS is redistributed under MIT, so a copyleft or source-available runtime dependency
 * would impose obligations that redistribution cannot honour. Deny by default, so an
 * unusual license gets a human decision. Dev dependencies are not redistributed.
 */

import { execSync } from "node:child_process";

// OSI-approved permissive licenses compatible with MIT redistribution.
const ALLOWED = new Set([
  "MIT",
  "ISC",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "Unlicense",
  "CC0-1.0",
  "BlueOak-1.0.0",
  "Python-2.0",
  "WTFPL",
  "MIT-0",
  "MPL-2.0", // file-level copyleft; permissive enough to consume as a dependency
  "CC-BY-4.0", // attribution-only content license; build-time browser data (caniuse-lite), not shipped in the runtime bundle
]);

function normalize(license) {
  // An SPDX `OR` passes when any disjunct is allowed; an `AND` needs every part allowed.
  const expr = license.replace(/[()]/g, "").trim();
  if (/\bOR\b/i.test(expr)) return expr.split(/\bOR\b/i).map((s) => s.trim());
  if (/\bAND\b/i.test(expr)) return { and: expr.split(/\bAND\b/i).map((s) => s.trim()) };
  return [expr];
}

function isAllowed(license) {
  const n = normalize(license);
  if (Array.isArray(n)) return n.some((l) => ALLOWED.has(l));
  return n.and.every((l) => ALLOWED.has(l));
}

// A shell is required because Node on Windows cannot spawn `pnpm.cmd` without one.
const raw = execSync("pnpm licenses list --prod --json", {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
/** @type {Record<string, Array<{name:string}>>} */
const byLicense = JSON.parse(raw);

const violations = [];
for (const [license, pkgs] of Object.entries(byLicense)) {
  if (license === "Unknown" || !isAllowed(license)) {
    const names = [...new Set((pkgs ?? []).map((p) => p.name))].sort();
    violations.push(`  ${license}: ${names.join(", ")}`);
  }
}

if (violations.length > 0) {
  console.error(
    "check-licenses: runtime dependency license(s) not on the permissive allow-list:\n",
  );
  for (const v of violations) console.error(v);
  console.error(
    "\nCopyleft/source-available/unknown licenses are forbidden in the runtime tree (MIT redistribution).",
  );
  console.error(
    "If a license is genuinely permissive and MIT-compatible, add it to ALLOWED in this script with a note.",
  );
  process.exit(1);
}

const count = Object.values(byLicense).reduce((n, p) => n + (p?.length ?? 0), 0);
console.log(
  `check-licenses: OK - ${count} runtime deps, all permissive (${Object.keys(byLicense).sort().join(", ")}).`,
);
