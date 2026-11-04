import {
  createTestAdmin as createAdminAccount,
  openDbHandle,
} from "../../../api/e2e/support/admin-accounts.js";
import { readFixtures } from "../../../portal/e2e/support/fixtures.js";

import { ADMIN_BASE_URL, FIXED_AUTH_SECRET } from "./harness-config.js";

// A run-local password prevents a credential leaked by one run from authorizing the next.
export const TEST_PASSWORD = `e2e-admin-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;

// Separate accounts keep spec files from sharing mutable two-factor state.
export function uniqueAdminEmail(label: string): string {
  return `e2e.${label}.${Date.now().toString(36)}@admin.test`;
}

// Create the account without a confirmed factor so enrollment still exercises the browser flow.
export async function createTestAdmin(
  email: string,
  options: {
    readonly name?: string;
    readonly mustChangePassword?: boolean;
    // Defaults to full team grants; the installation claim alone authorizes no authoring or response reads.
    readonly grants?: readonly string[];
    readonly owner?: boolean;
  } = {},
): Promise<void> {
  await createAdminAccount({
    databaseUrl: readFixtures().databaseUrl,
    authSecret: FIXED_AUTH_SECRET,
    adminBaseUrl: ADMIN_BASE_URL,
    email,
    password: TEST_PASSWORD,
    ...(options.name !== undefined && { name: options.name }),
    ...(options.grants !== undefined && { grants: options.grants }),
    ...(options.owner !== undefined && { owner: options.owner }),
    mustChangePassword: options.mustChangePassword === true,
  });
}

// Enroll before marking provisional: the bootstrap gate prevents a provisional account from enrolling.
export async function markProvisional(email: string): Promise<void> {
  const handle = openDbHandle(readFixtures().databaseUrl);
  try {
    const updated = await handle.query(
      `update "user" set "mustChangePassword" = true where email = $1`,
      [email],
    );
    // The harness row type omits the driver's rowCount; verify a matched account so the fixture cannot pass vacuously.
    if (updated.rows.length === 0 && (updated as { rowCount?: number }).rowCount === 0) {
      throw new Error(`markProvisional matched no account for ${email}`);
    }
  } finally {
    await handle.close();
  }
}
