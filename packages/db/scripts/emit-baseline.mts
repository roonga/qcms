#!/usr/bin/env node
/**
 * Write the hand-authored half of the baseline migration from the schema modules.
 *
 * The generated half above it is `drizzle-kit generate`'s and is never touched here:
 * this script finds the marker, keeps everything before it, and replaces everything
 * from it onward with what `src/environment/baseline.ts` currently emits.
 *
 * Run it after changing the **data-plane** schema module, the per-environment generator
 * or the grants. `baseline.test.ts` fails until you have, which is the point: the
 * checked-in SQL and the module that produces it cannot drift, and the counts in the
 * plan and in ADR-40 are checked against the derivation rather than the other way
 * round.
 *
 *     pnpm --filter @roonga/qcms-db db:emit-baseline
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { HAND_AUTHORED_MARKER, baselineHandAuthoredSql } from "../src/environment/baseline.js";

const BASELINE = fileURLToPath(
  new URL("../migrations/0000_environments_baseline.sql", import.meta.url),
);

const current = readFileSync(BASELINE, "utf8");
const markerStart = current.indexOf(HAND_AUTHORED_MARKER.split("\n")[0] ?? "");
const generated =
  markerStart === -1
    ? `${current.trimEnd()}\n--> statement-breakpoint\n`
    : current.slice(0, markerStart);

writeFileSync(BASELINE, `${generated}${baselineHandAuthoredSql()}\n`, "utf8");
process.stdout.write(`wrote the hand-authored half of ${BASELINE}\n`);
