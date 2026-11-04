import { fileURLToPath } from "node:url";

import { PORT_SEAT, harnessPort } from "../../../portal/e2e/support/port-seat.js";

export const ADMIN_PORT = harnessPort("admin", PORT_SEAT);

// The BFF origin check and API auth origin must agree on where the session cookies belong.
export const ADMIN_BASE_URL = `http://localhost:${ADMIN_PORT}`;

// Synthetic and fixed so a reused API server and a fresh test runner verify the same cookies.
export const FIXED_AUTH_SECRET = "qcms-e2e-admin-better-auth-secret-0000000000";

// Captured for diagnostics; this file is outside the portal harness's server-log gate.
export const ADMIN_SERVER_LOG = fileURLToPath(
  new URL("../../.playwright/server-logs/admin.log", import.meta.url),
);
