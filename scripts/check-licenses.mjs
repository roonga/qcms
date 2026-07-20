#!/usr/bin/env node
// @ts-check
/**
 * Dependency license gate (CONTRIBUTING dependency policy).
 *
 * QCMS ships under MIT and is redistributed as scaffolded source + published
 * packages, so every **runtime** dependency must carry a permissive,
 * MIT-compatible license. Copyleft (GPL/AGPL/LGPL/SSPL/EUPL), source-available
 * (BUSL/Elastic), and unlicensed/proprietary deps are forbidden in the runtime
 * tree - they'd impose obligations MIT redistribution can't honor.
 *
 * Deny-by-default: any license NOT on the allow-list fails the build, so a new
 * or unusual license gets a human decision instead of silently shipping. Dev
 * dependencies are not checked (not redistributed).
 *
 * Uses `pnpm licenses list --prod --json` - no extra dependency.
 * Usage:  node scripts/check-licenses.mjs
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
]);

function normalize(license) {
  // pnpm may report SPDX expressions like "(MIT OR Apache-2.0)" - allow if ANY
  // disjunct is allowed; for "AND" every part must be allowed.
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

// execSync (shell) rather than execFile: Node on Windows won't spawn pnpm.cmd
// via execFile without a shell (EINVAL); a plain string command works on both.
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
