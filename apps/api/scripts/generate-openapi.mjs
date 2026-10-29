// Reads the built `dist/`, so run it through `pnpm openapi:generate`, which builds first.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildApiDocuments } from "../dist/index.js";

const outDir = new URL("../../../docs/openapi/", import.meta.url);
const { respondent, admin } = buildApiDocuments();

for (const [name, doc] of Object.entries({ respondent, admin })) {
  const target = new URL(`${name}.json`, outDir);
  writeFileSync(target, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`wrote ${fileURLToPath(target)}`);
}
