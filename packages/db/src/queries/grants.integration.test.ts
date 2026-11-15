import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authUser } from "../schema/control/auth.js";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  SEED_WORKSPACE_ID,
  startTestDb,
  type TestDb,
} from "../testing/harness.js";
import {
  EMPTY_MEMBER_ROLE,
  addAccessGroupHolder,
  createAccessGroup,
  ensureWorkspaceMember,
  listGrantsForUser,
  listMemberWorkspacesForUser,
  resolveMembership,
} from "./index.js";

let testDb: TestDb;

const AT = new Date("2026-07-20T00:00:00.000Z");

/**
 * A holder of one member row and one access group, so each read below has a row to return
 * and the account's own state is the only thing that decides whether it does.
 */
async function seedHolder(
  label: string,
  state: { readonly disabledAt?: Date; readonly claimedAt: Date | null },
): Promise<{ readonly userId: string; readonly teamId: string }> {
  const userId = `au_filter_${label}`;
  await testDb.db.insert(authUser).values({
    id: userId,
    name: `Filter ${label}`,
    email: `filter.${label}@admin.test`,
    createdAt: AT,
    updatedAt: AT,
    claimedAt: state.claimedAt,
    ...(state.disabledAt === undefined ? {} : { disabledAt: state.disabledAt }),
  });
  const group = await createAccessGroup(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    name: `Filter ${label}`,
    roles: ["forms.editor"],
    environments: [],
  });
  await ensureWorkspaceMember(testDb.db, SEED_WORKSPACE_ID, userId);
  await addAccessGroupHolder(testDb.db, group.teamId, userId);
  return { userId, teamId: group.teamId };
}

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe("the account state filter on every read a decision is made from", () => {
  it("reports an active, claimed holder from all three reads", async () => {
    const holder = await seedHolder("active", { claimedAt: AT });

    const membership = await resolveMembership(testDb.db, holder.userId, SEED_WORKSPACE_ID);
    expect(membership.memberRole).toBe(EMPTY_MEMBER_ROLE);
    expect(membership.grants.map((row) => row.teamId)).toEqual([holder.teamId]);
    expect(await listGrantsForUser(testDb.db, holder.userId)).toHaveLength(1);
    expect(await listMemberWorkspacesForUser(testDb.db, holder.userId)).toHaveLength(1);
  });

  it("reports nothing for a disabled holder", async () => {
    const holder = await seedHolder("disabled", { claimedAt: AT, disabledAt: AT });

    const membership = await resolveMembership(testDb.db, holder.userId, SEED_WORKSPACE_ID);
    expect(membership.memberRole).toBeUndefined();
    expect(membership.grants).toEqual([]);
    expect(await listGrantsForUser(testDb.db, holder.userId)).toEqual([]);
    expect(await listMemberWorkspacesForUser(testDb.db, holder.userId)).toEqual([]);
  });

  it("reports nothing for an unclaimed holder", async () => {
    const holder = await seedHolder("unclaimed", { claimedAt: null });

    const membership = await resolveMembership(testDb.db, holder.userId, SEED_WORKSPACE_ID);
    expect(membership.memberRole).toBeUndefined();
    expect(membership.grants).toEqual([]);
    expect(await listGrantsForUser(testDb.db, holder.userId)).toEqual([]);
    expect(await listMemberWorkspacesForUser(testDb.db, holder.userId)).toEqual([]);
  });
});
