import { openDbHandle } from "../../../api/e2e/support/admin-accounts.js";
import { readFixtures } from "../../../portal/e2e/support/fixtures.js";

/**
 * Suspend one hold as a credential reset by `performerEmail` would, so a spec reaches the
 * re-confirm state without driving the Site configuration screens.
 */
export async function suspendHold(
  workspaceId: string,
  groupName: string,
  email: string,
  performerEmail: string,
): Promise<void> {
  const handle = openDbHandle(readFixtures().databaseUrl);
  try {
    const updated = await handle.query<{ id: string }>(
      `update "teamMember" set "suspendedAt" = now(),
              "suspendedBy" = (select id from "user" where email = $4)
        where "teamId" = (select id from "team" where name = $2 and "organizationId" = $1)
          and "userId" = (select id from "user" where email = $3)
        returning id`,
      [workspaceId, groupName, email, performerEmail],
    );
    if (updated.rows.length !== 1) {
      throw new Error(`suspendHold matched no hold for ${email} in ${groupName}`);
    }
  } finally {
    await handle.close();
  }
}
