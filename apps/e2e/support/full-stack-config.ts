import { PORT_SEAT, harnessPort } from "../../portal/e2e/support/port-seat.js";

/**
 * Where the full-stack smoke stack is reachable from the Playwright runner (036).
 *
 * `scripts/compose-e2e.mjs` owns that stack: it derives this seat's harness ports
 * from `scripts/ports.mjs`, publishes them, and exports `QCMS_PORTAL_BASE_URL` and
 * `QCMS_ADMIN_BASE_URL` to the Playwright runner. Those two names are the whole
 * contract between the script and the browser side, and this module is the one
 * place they are read: `playwright.compose.config.ts` and the spec import from
 * here rather than reaching for the environment themselves, so there is one
 * allocation, not one per file.
 *
 * **On the normal path the two constants below never use their fallback**, because
 * the script always exports both names. The fallback exists so `pnpm exec playwright
 * test --config=playwright.compose.config.ts` still finds a stack that is already up
 * when someone runs the config directly, and it derives the same numbers from the
 * same module rather than restating them (R8 is a rule about derivation,
 * `docs/PORTS.md`).
 *
 * ## Why `localhost` is right here, and why that took a bug to establish
 *
 * Issue #316 reported this file as the cause of `ECONNREFUSED` from the dev
 * container, and the address is indeed unreachable there: a compose-published port
 * lands on the Docker HOST's loopback, and inside the dev container that host is
 * another machine. But changing the address here would have been the wrong repair
 * twice over. It is dead code on the failing path (the exported environment wins),
 * and more importantly a `Secure` cookie can only be stored by a **trustworthy
 * origin**: Chromium counts `http://localhost` as one and a bare IPv4 gateway as
 * not, so browsing the gateway drops better-auth's session and two-factor cookies
 * and admin sign-in bounces. Suppressing `Secure` to compensate would make the local
 * run exercise a different cookie configuration than CI, which is precisely the
 * coverage this suite exists to provide.
 *
 * So the origin stays `localhost` in every environment, and the harness makes that
 * address true inside the container by forwarding this container's loopback to the
 * service containers (`scripts/loopback-forward.mjs`). This constant did not need to
 * change; the environment it runs in did.
 */

/** The respondent portal published by the full-stack smoke stack. */
export const FULL_STACK_PORTAL_URL =
  process.env.QCMS_PORTAL_BASE_URL ??
  `http://localhost:${String(harnessPort("portal", PORT_SEAT))}`;

/** The authoring admin published by the full-stack smoke stack. */
export const FULL_STACK_ADMIN_URL =
  process.env.QCMS_ADMIN_BASE_URL ?? `http://localhost:${String(harnessPort("admin", PORT_SEAT))}`;
