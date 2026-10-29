/**
 * Example forms are rendered to real respondents, so their content must stay in the
 * neutral vehicle domain (043). Scope is only the fixture JSON the seed consumes:
 * docs and the frozen golden corpus discuss health in prose legitimately.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DENYLIST = [
  "medical",
  "diabetes",
  "asthma",
  "smok",
  "health",
  "pregnan",
  "disease",
  "diagnos",
  "illness",
  "prescription",
];

export const FIXTURE_DIR = fileURLToPath(
  new URL("../apps/api/e2e/support/fixtures/", import.meta.url),
);

export function scanText(label, text) {
  const lower = text.toLowerCase();
  return DENYLIST.filter((term) => lower.includes(term)).map((term) => ({ file: label, term }));
}

export function scanFixtureDir(dir = FIXTURE_DIR) {
  const hits = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".json")) continue;
    hits.push(...scanText(file, readFileSync(join(dir, file), "utf8")));
  }
  return hits;
}

function main() {
  const hits = scanFixtureDir();
  if (hits.length > 0) {
    console.error(
      "check-fixture-domain: FAIL - example-form fixture(s) contain denylisted health/sensitive terms:",
    );
    for (const hit of hits) console.error(`  ${hit.file}: "${hit.term}"`);
    console.error(
      "Example-form content is shown to real respondents; keep it in a neutral (vehicle) domain (043).",
    );
    process.exit(1);
  }
  console.log(`check-fixture-domain: OK - no denylisted terms in ${FIXTURE_DIR}`);
}

// Run as a script; stay silent when imported by the self-test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
