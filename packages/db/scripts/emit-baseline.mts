#!/usr/bin/env node
// pnpm --filter @roonga/qcms-db db:emit-baseline
//
// Everything above the marker is `drizzle-kit generate`'s and is never touched here.
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
