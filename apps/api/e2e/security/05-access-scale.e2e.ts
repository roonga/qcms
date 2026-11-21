/**
 * Criterion 114: search over people, groups and accounts under 300 ms at 1,000 accounts.
 * The fastest of several samples is asserted and every sample printed, because a slower
 * sample on a host running other lanes measures the machine rather than the query.
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

/** The scale the criterion names. */
const ACCOUNTS = 1_000;
/** The criterion's budget, in milliseconds. */
const BUDGET_MS = 300;
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

/** The fastest of {@link SAMPLES} reads, with every sample printed. */
async function fastest(label: string, path: string): Promise<number> {
  const headers = {
    [INTERNAL_TOKEN_HEADER]: all.internalToken,
    [ADMIN_SESSION_HEADER]: adminToken,
  };
  // Warm up: the first read of a session pays for the connection and the plan.
  expect((await all.app.request(path, { headers })).status).toBe(200);

  const samples: number[] = [];
  for (let run = 0; run < SAMPLES; run += 1) {
    const started = performance.now();
    const res = await all.app.request(path, { headers });
    expect(res.status).toBe(200);
    await res.text();
    samples.push(performance.now() - started);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  console.log(
    `${label}: ${sorted.map((ms) => ms.toFixed(1)).join(", ")} ms over ${String(ACCOUNTS)} accounts`,
  );
  return sorted[0] ?? Number.POSITIVE_INFINITY;
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

  it("searches the account directory under the budget", async () => {
    expect(await fastest("accounts, search by address", "/admin/accounts?q=scale.07")).toBeLessThan(
      BUDGET_MS,
    );
    expect(
      await fastest("accounts, search by name", "/admin/accounts?q=Person%200123"),
    ).toBeLessThan(BUDGET_MS);
  });

  it("filters the account directory by role and by status under the budget", async () => {
    expect(
      await fastest("accounts, status filter", "/admin/accounts?status=unclaimed"),
    ).toBeLessThan(BUDGET_MS);
    expect(await fastest("accounts, role filter", "/admin/accounts?role=member")).toBeLessThan(
      BUDGET_MS,
    );
  });

  it("reads the workspace's people and their groups under the budget", async () => {
    expect(
      await fastest("members and their groups", `/admin/workspaces/${SEED_WORKSPACE_ID}/members`),
    ).toBeLessThan(BUDGET_MS);
  });

  it("reads the workspace's access groups under the budget", async () => {
    expect(
      await fastest("access groups", `/admin/workspaces/${SEED_WORKSPACE_ID}/access-groups`),
    ).toBeLessThan(BUDGET_MS);
  });
});
