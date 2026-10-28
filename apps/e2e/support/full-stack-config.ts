import { PORT_SEAT, harnessPort } from "../../portal/e2e/support/port-seat.js";

// The host must stay `localhost` in every environment: only a trustworthy origin may
// store a `Secure` cookie, so a bare gateway address drops the session and two-factor
// cookies. Inside the dev container the harness forwards loopback instead
// (`scripts/loopback-forward.mjs`).

export const FULL_STACK_PORTAL_URL =
  process.env.QCMS_PORTAL_BASE_URL ??
  `http://localhost:${String(harnessPort("portal", PORT_SEAT))}`;

export const FULL_STACK_ADMIN_URL =
  process.env.QCMS_ADMIN_BASE_URL ?? `http://localhost:${String(harnessPort("admin", PORT_SEAT))}`;
