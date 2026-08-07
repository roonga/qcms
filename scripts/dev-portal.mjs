/**
 * `pnpm dev:portal` - the dev database, the API and the respondent portal, wired
 * together and ready to open in a browser (task 030).
 *
 * Everything this does lives in `scripts/dev-stack.mjs`, which `pnpm dev:admin` shares.
 * The two front ends need the same dev database, the same migrations and the same
 * in-memory SEC-4 token, so one module owns that sequence and these entry points only
 * say which front end they want. A second script re-deriving the setup is exactly how
 * the two would drift (issue #281).
 */

import { runDevStack } from "./dev-stack.mjs";

await runDevStack({ frontend: "portal", name: "dev-portal" });
