import { PORT_SEAT, harnessPort } from "../../../portal/e2e/support/port-seat.js";

/**
 * Where the Compose smoke stack is reachable from the host (task 036).
 *
 * `scripts/compose-e2e.mjs` owns that stack: it derives this seat's harness ports
 * from `scripts/ports.mjs`, publishes them, and exports `QCMS_PORTAL_BASE_URL` and
 * `QCMS_ADMIN_BASE_URL` to the Playwright runner. Those two names are the whole
 * contract between the script and the browser side, and this module is the one
 * place they are read: `playwright.compose.config.ts` and the spec import from
 * here rather than reaching for the environment themselves, so there is one
 * allocation, not one per file.
 *
 * The fallback exists so `pnpm exec playwright test --config=playwright.compose.config.ts`
 * still finds the stack when someone runs the config directly, and it derives the
 * same numbers from the same module rather than restating them (R8 is a rule about
 * derivation, `docs/PORTS.md`).
 */

/** The respondent portal published by the Compose smoke stack. */
export const COMPOSE_PORTAL_URL =
  process.env.QCMS_PORTAL_BASE_URL ??
  `http://localhost:${String(harnessPort("portal", PORT_SEAT))}`;

/** The authoring admin published by the Compose smoke stack. */
export const COMPOSE_ADMIN_URL =
  process.env.QCMS_ADMIN_BASE_URL ?? `http://localhost:${String(harnessPort("admin", PORT_SEAT))}`;
