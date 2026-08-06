import { publishedPortOrigin } from "../../../scripts/docker-host.mjs";
import { PORT_SEAT, harnessPort } from "../../portal/e2e/support/port-seat.js";

/**
 * Where the full-stack smoke stack is reachable from this process (task 036).
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
 *
 * ## Why the host is resolved rather than written as `localhost` (issue #316)
 *
 * These are the one part of the harness block that is genuinely **published**, on
 * the Docker host. In the canonical dev container (ADR-29) that host is not this
 * process: `docker compose` there drives the mounted host socket, so the stack comes
 * up as a set of siblings on the *host's* loopback and this container's `127.0.0.1`
 * has nothing on it. A hardcoded `localhost` therefore failed in `beforeAll` with
 * `ECONNREFUSED` while every container reported healthy, which made `pnpm up:e2e`
 * CI-only from the environment the repo calls canonical.
 *
 * `publishedPortHost()` answers that for all three environments (dev container: the
 * default-route gateway; plain host checkout and CI runner: `localhost`, reached
 * before anything is probed). It is the resolution `scripts/dev-portal.mjs` has used
 * for the dev database since task 030, extracted so the two cannot drift apart
 * again.
 */

/** The respondent portal published by the full-stack smoke stack. */
export const FULL_STACK_PORTAL_URL =
  process.env.QCMS_PORTAL_BASE_URL ?? publishedPortOrigin(harnessPort("portal", PORT_SEAT));

/** The authoring admin published by the full-stack smoke stack. */
export const FULL_STACK_ADMIN_URL =
  process.env.QCMS_ADMIN_BASE_URL ?? publishedPortOrigin(harnessPort("admin", PORT_SEAT));
