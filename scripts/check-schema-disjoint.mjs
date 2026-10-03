#!/usr/bin/env node
// @ts-check
/**
 * The control-plane and data-plane table-name sets stay disjoint (ADR-40, criterion 3a).
 *
 * ## The failure this prevents
 *
 * A connection's search path is `data_<env>, control`, with the **data plane first**.
 * So a table name declared in both schemas resolves to the **environment's copy**, and
 * nothing anywhere says so: no error, no warning, and a control-plane read that quietly
 * became a per-environment one. A form read that started returning one environment's
 * row would be a defect nobody could see in a diff, because both declarations are
 * individually correct.
 *
 * Leaving the search-path order alone and checking the sets is the right way round.
 * `control, data_<env>` would shadow the other way and would break criterion 3's
 * resolution half, which is the property the whole layout rests on.
 *
 * ## Why it is cheap
 *
 * Since task 064 split `packages/db/src/schema/` into a control module and a data-plane
 * module, each set is declared in exactly one place. The check is their intersection
 * being empty, and that is the whole of it - which is what `CONTRIBUTING.md` asks for
 * when it says a derived set beats a hand-kept copy.
 *
 * It reads the two index modules' **declaration lists** rather than importing them,
 * because `check:all` runs without a build and this package's runtime entry pulls in
 * Drizzle and the whole schema graph. The parse is deliberately narrow: it finds the
 * one array literal in each module and takes the table identifier from each entry, and
 * it **fails loudly** when it cannot, rather than reporting an empty intersection over
 * two empty sets - a control that reports nothing reads exactly like a control that
 * found nothing wrong.
 *
 * ## What it cannot see
 *
 * A table declared in a schema module but left out of that module's declaration list.
 * That is a real gap and it is covered elsewhere rather than here:
 * `packages/db/src/migrations.test.ts` compares each schema's **created** table set
 * against the same lists, exactly, against a real Postgres, so a table missing from a
 * list fails there naming it (issue #861).
 */
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);

/** The two modules, and the array in each whose entries name that plane's tables. */
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
 * The identifiers listed in `const <array>: ... = [ ... ];`.
 *
 * Entries read `module.tableName,`; the property name is what identifies the table
 * here, and the intersection is computed over those. Two planes cannot share a property
 * name either, which is a slightly stronger property than sharing a Postgres table name
 * and is the one a reader of the two modules can check by eye.
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
