/**
 * Fixture-content guard (task 045): FAIL THE BUILD if an example-form fixture
 * contains health/sensitive terms. Example forms are rendered to real
 * respondents, so their content must stay in a neutral (vehicle) domain (043);
 * this keeps medical content from silently creeping back into the seeded
 * kitchen-sink form the portal e2e AND `pnpm dev:portal` publish.
 *
 * SCOPE: only the example-form fixture files this task owns - the vehicle
 * kitchen-sink definition, its two unique question fixtures, and the compiled
 * golden generated from them, all under `apps/api/e2e/support/fixtures/`. It does
 * NOT scan docs/ADRs (which legitimately discuss insurance/health in prose), the
 * frozen kernel golden corpus, or the dev:portal script's own prose (its
 * health-check endpoint references would be false positives) - the seed consumes
 * exactly these JSON files, so scanning them covers the dev:portal fixture too.
 *
 * Wired into `pnpm lint` (so it runs in CI via the lint job) and exercised by a
 * positive self-test (apps/api/e2e/support/check-fixture-domain.test.ts).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Case-insensitive denylist of health/sensitive substrings (task 045). */
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

/** The one directory holding this task's vehicle example-form fixtures. */
export const FIXTURE_DIR = fileURLToPath(
  new URL("../apps/api/e2e/support/fixtures/", import.meta.url),
);

/** Return every denylist term found (case-insensitively) in `text`. */
export function scanText(label, text) {
  const lower = text.toLowerCase();
  return DENYLIST.filter((term) => lower.includes(term)).map((term) => ({ file: label, term }));
}

/** Scan every `.json` file in `dir`, returning all denylist hits. */
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
