/**
 * `pnpm dev:admin` - the dev database, the API and the authoring admin, wired together
 * and ready to open in a browser (issue #281).
 *
 * Before this existed the admin was the one app in the repo a human could not open by
 * following the docs: `7S40` was allocated but unpublished, there was no launcher, and
 * pointing a hand-started `next dev` at an already-running API meant recovering that
 * API's SEC-4 internal token out of its process environment, because
 * `scripts/dev-stack.mjs` generates it per run and writes it nowhere. Starting both
 * children from one process removes the problem rather than working around it: the
 * token is one in-memory value handed to both.
 *
 * The consequence, stated plainly because it is the trade: this starts its own API on
 * `7S10`, so it cannot run at the same seat as `pnpm dev:portal`. Give the second one
 * its own seat (`QCMS_PORT_SEAT=1 pnpm dev:admin`, see `docs/PORTS.md`).
 */

import { runDevStack } from "./dev-stack.mjs";

await runDevStack({ frontend: "admin", name: "dev-admin" });
