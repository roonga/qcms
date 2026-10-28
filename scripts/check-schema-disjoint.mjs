#!/usr/bin/env node
// @ts-check
/**
 * The search path puts the data plane first, so a table name declared in both schemas
 * silently resolves to the environment's copy, with both declarations individually
 * correct (ADR-40, criterion 3a).
 *
 * The declaration lists are parsed rather than imported, because `check:all` runs
 * without a build. The parse fails loudly when it cannot read a list: a control that
 * reports nothing reads exactly like one that found nothing wrong. A table missing from
 * a list is out of reach here and is caught by `packages/db/src/migrations.test.ts`.
 */
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);

const PLANES = [
  {
    label: "control plane",
    path: "packages/db/src/schema/control/index.ts",
    array: "CONTROL_TABLE_OBJECTS",
  },
  {
    label: "data plane",
    path: "packages/db/src/schema/data/index.ts",
    array: "DATA_PLANE_TABLES",
  },
];

/**
 * The property name identifies the table here, which is slightly stronger than the
 * Postgres table name and is the one a reader can check by eye.
 */
function declaredTables(source, arrayName, label) {
  const start = source.indexOf(`const ${arrayName}`);
  if (start === -1) throw new Error(`${label}: no \`const ${arrayName}\` in the module`);
  const open = source.indexOf("[", start);
  const close = source.indexOf("];", open);
  if (open === -1 || close === -1) throw new Error(`${label}: \`${arrayName}\` is not an array`);
  const entries = source
    .slice(open + 1, close)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith("//"));
  const names = entries.map((entry) => entry.split(".").at(-1) ?? entry);
  if (names.length === 0) throw new Error(`${label}: \`${arrayName}\` is empty`);
  return names;
}

const sets = PLANES.map((plane) => {
  const source = readFileSync(fileURLToPath(new URL(plane.path, ROOT)), "utf8");
  return { ...plane, tables: declaredTables(source, plane.array, plane.label) };
});

const [control, data] = sets;
const controlNames = new Set(control.tables);
const shared = data.tables.filter((name) => controlNames.has(name));

if (shared.length > 0) {
  process.stderr.write(
    "check:schema-disjoint failed: these tables are declared in BOTH planes, so the\n" +
      "search path `data_<env>, control` would resolve each to the environment's copy\n" +
      "with no error anywhere (ADR-40, criterion 3a):\n" +
      shared.map((name) => `  ${name}\n`).join(""),
  );
  process.exit(1);
}

process.stdout.write(
  `check:schema-disjoint: ${String(control.tables.length)} control-plane and ` +
    `${String(data.tables.length)} data-plane tables, no name in both\n`,
);
