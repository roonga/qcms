/**
 * Criterion 114: search over people, groups and accounts under 300 ms at 1,000 accounts.
 * The median of several samples is asserted and every sample printed, so one slow sample
 * on a host running other lanes neither fails the gate nor hides a regression.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  authMember,
  authTeamMember,
  authUser,
  createAccessGroup,
  type Executor,
} from "@roonga/qcms-db";
import { SEED_WORKSPACE_ID } from "@roonga/qcms-db/testing";

import { seedAdminSession } from "../../src/test-support.js";
import {
  MOUNT,
  buildEnv,
  composeApi,
  siteAdminLogin,
  startTestDb,
  type TestDb,
} from "../support/index.js";

const ADMIN_SESSION_HEADER = "x-qcms-admin-session";
const INTERNAL_TOKEN_HEADER = "x-qcms-internal-token";

const ACCOUNTS = 1_000;
const BUDGET_MS = 300;
/** Odd, so the median is a sample rather than a mean of two. */
const SAMPLES = 5;
/** Rows per insert: one statement per account would spend the suite's budget on setup. */
const CHUNK = 200;

let testDb: TestDb;
let all: ReturnType<typeof composeApi>;
let adminToken: string;

async function insertChunked<T>(
  rows: readonly T[],
  write: (chunk: readonly T[]) => Promise<unknown>,
): Promise<void> {
  for (let at = 0; at < rows.length; at += CHUNK) {
    await write(rows.slice(at, at + CHUNK));
  }
}

async function seedAccounts(exec: Executor, teamId: string): Promise<void> {
  const at = new Date("2026-07-01T00:00:00.000Z");
  const ids = Array.from(
    { length: ACCOUNTS },
    (_, index) => `usr_scale_${String(index).padStart(4, "0")}`,
  );

  await insertChunked(ids, (chunk) =>
    exec.insert(authUser).values(
      chunk.map((id, index) => ({
        id,
        // Distinct surnames and addresses, so a search really narrows rather than
        // matching every row or none.
        name: `Scale Person ${id.slice(-4)}`,
        email: `scale.${id.slice(-4)}@accounts.test`,
        emailVerified: true,
        createdAt: at,
        updatedAt: at,
        twoFactorEnabled: true,
        mustChangePassword: false,
        // A tenth unclaimed, so the status filter has both kinds to separate.
        claimedAt: index % 10 === 0 ? null : at,
      })),
    ),
  );

  await insertChunked(ids, (chunk) =>
    exec.insert(authMember).values(
      chunk.map((id) => ({
        id: `mbr_scale_${id.slice(-4)}`,
        organizationId: SEED_WORKSPACE_ID,
        userId: id,
        role: "member",
      })),
    ),
  );

  await insertChunked(ids, (chunk) =>
    exec.insert(authTeamMember).values(
      chunk.map((id) => ({
        id: `tmm_scale_${id.slice(-4)}`,
        teamId,
        userId: id,
        membershipKey: `${teamId}:${id}`,
      })),
    ),
  );
}

/**
 * Reads `path` once to check what it returned, then {@link SAMPLES} times to measure it.
 * A query that narrowed to nothing, or that was ignored, fails `check` rather than
 * reporting a fast read of the wrong rows.
 */
async function measure(
  label: string,
  path: string,
  check: (body: Record<string, unknown>) => void,
): Promise<number> {
  const headers = {
    [INTERNAL_TOKEN_HEADER]: all.internalToken,
    [ADMIN_SESSION_HEADER]: adminToken,
  };
  // The first read of a session pays for the connection and the plan, and is the one whose
  // body is checked.
  const warm = await all.app.request(path, { headers });
  expect(warm.status, label).toBe(200);
  check((await warm.json()) as Record<string, unknown>);

  const samples: number[] = [];
  for (let run = 0; run < SAMPLES; run += 1) {
    const started = performance.now();
    const res = await all.app.request(path, { headers });
    expect(res.status, label).toBe(200);
    await res.text();
    samples.push(performance.now() - started);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  console.log(
    `${label}: ${sorted.map((ms) => ms.toFixed(1)).join(", ")} ms over ${String(ACCOUNTS)} accounts`,
  );
  return sorted[(SAMPLES - 1) / 2] ?? Number.POSITIVE_INFINITY;
}

interface AccountRow {
  readonly email: string;
  readonly name: string;
  readonly role: string;
  readonly status: string;
}

function accountsOf(body: Record<string, unknown>): readonly AccountRow[] {
  const rows = body["accounts"] as AccountRow[] | undefined;
  expect(rows ?? [], "the page carried no accounts, so the filter matched nothing").not.toEqual([]);
  return rows ?? [];
}

beforeAll(async () => {
  testDb = await startTestDb();
  all = composeApi(testDb.db, buildEnv(), MOUNT.all);
  adminToken = await siteAdminLogin(testDb.db);

  const group = await createAccessGroup(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    name: "Scale authors",
    roles: ["forms.editor"],
    environments: [],
  });
  await seedAccounts(testDb.db, group.teamId);

  // A second group, so the groups list is a list rather than one row.
  await createAccessGroup(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    name: "Scale publishers",
    roles: ["forms.publisher"],
    environments: ["prod"],
  });
  // One more account with a session, to prove the fixture is the scale and not the cap.
  await seedAdminSession(testDb.db, { label: "scale-bystander" });
}, 180_000);

afterAll(async () => {
  await testDb?.teardown();
});

describe("search at 1,000 accounts (criterion 114)", () => {
  it("seeded the scale the criterion names, so the measurements below mean something", async () => {
    const res = await all.app.request("/admin/accounts?pageSize=1", {
      headers: {
        [INTERNAL_TOKEN_HEADER]: all.internalToken,
        [ADMIN_SESSION_HEADER]: adminToken,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number };
    expect(body.total).toBeGreaterThanOrEqual(ACCOUNTS);
  });

  it("searches the account directory under the budget, narrowed to the match", async () => {
    // One hundred of the thousand carry `scale.07` in their address.
    expect(
      await measure("accounts, search by address", "/admin/accounts?q=scale.07", (body) => {
        expect(body["total"]).toBe(100);
        for (const row of accountsOf(body)) expect(row.email).toContain("scale.07");
      }),
    ).toBeLessThan(BUDGET_MS);

    // The search reads the display name as well as the address, and this one names a row.
    expect(
      await measure("accounts, search by name", "/admin/accounts?q=Person%200123", (body) => {
        expect(body["total"]).toBe(1);
        expect(accountsOf(body)[0]?.name).toBe("Scale Person 0123");
      }),
    ).toBeLessThan(BUDGET_MS);
  });

  it("filters the account directory by role and by status under the budget", async () => {
    // Every tenth account is seeded unclaimed.
    expect(
      await measure("accounts, status filter", "/admin/accounts?status=unclaimed", (body) => {
        expect(body["total"]).toBe(ACCOUNTS / 10);
        for (const row of accountsOf(body)) expect(row.status).toBe("unclaimed");
      }),
    ).toBeLessThan(BUDGET_MS);

    // Narrower than the unfiltered list, which also holds the Site administrator.
    expect(
      await measure("accounts, role filter", "/admin/accounts?role=member", (body) => {
        expect(body["total"]).toBeGreaterThanOrEqual(ACCOUNTS);
        for (const row of accountsOf(body)) expect(row.role).toBe("member");
      }),
    ).toBeLessThan(BUDGET_MS);
  });

  it("reads the workspace's people and their groups under the budget", async () => {
    expect(
      await measure(
        "members and their groups",
        `/admin/workspaces/${SEED_WORKSPACE_ID}/members`,
        (body) => {
          const members = body["members"] as { email?: string; groups?: string[] }[] | undefined;
          expect(members?.length ?? 0).toBeGreaterThanOrEqual(ACCOUNTS);
          // The seeded group reaches every one of them, so the read really joins holders.
          // Found by address, because the list is ordered by one and this workspace holds
          // the suite's own accounts too.
          const seeded = (members ?? []).find((member) =>
            (member.email ?? "").startsWith("scale."),
          );
          expect(seeded?.groups).toContain("Scale authors");
        },
      ),
    ).toBeLessThan(BUDGET_MS);
  });

  it("reads the workspace's access groups under the budget", async () => {
    expect(
      await measure(
        "access groups",
        `/admin/workspaces/${SEED_WORKSPACE_ID}/access-groups`,
        (body) => {
          const groups = body["groups"] as { name?: string }[] | undefined;
          expect((groups ?? []).map((group) => group.name)).toEqual(
            expect.arrayContaining(["Scale authors", "Scale publishers"]),
          );
        },
      ),
    ).toBeLessThan(BUDGET_MS);
  });
});
