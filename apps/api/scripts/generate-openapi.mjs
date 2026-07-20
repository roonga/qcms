/**
 * Regenerate the committed OpenAPI documents (task 027).
 *
 *   pnpm openapi:generate
 *
 * Writes `docs/openapi/respondent.json` and `docs/openapi/admin.json` from the
 * composed app's `@hono/zod-openapi` route registry (the single generator in
 * `apps/api/src/openapi-document.ts`). The drift check (`src/openapi-document.test.ts`,
 * part of `pnpm test`) fails CI if these committed files fall out of sync, so
 * run this whenever a route's schema changes and commit the result.
 *
 * Plain ESM over the built `dist/` so it needs no TS runtime; `pnpm openapi:generate`
 * builds first. Writes 2-space JSON with a trailing newline (Prettier-clean).
 */

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
