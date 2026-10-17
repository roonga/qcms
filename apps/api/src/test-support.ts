/**
 * Test-only fixtures (task 017). Excluded from the published build
 * (`tsconfig.build.json`) - never shipped, never imported by runtime code.
 *
 * Secrets here are **synthetic, generated in-test** (SEC: no real secret ever
 * enters a fixture). `synthSecret()` returns fresh random base64url material at
 * or above the config minimum length.
 */

import {
  addAccessGroupHolder,
  authSession,
  authUser,
  createAccessGroup,
  ensureWorkspaceMember,
  listAccessGroups,
  listWorkspaces,
  setMemberRole,
} from "@roonga/qcms-db";

import type { Config, MountFlags } from "./config.js";
import { loadConfig } from "./config.js";
import type { Deps } from "./deps.js";
import { PROD_ENVIRONMENT, type Databases } from "./environments.js";
import { selectDraftAssistant } from "./features/forms/assist/assistant.js";
import type { DraftAssistant } from "./features/forms/assist/types.js";
import { type ChallengeVerifier, nullChallengeVerifier } from "./features/responses/challenge.js";
import { createJsonLogger, createNullLogger, type Logger } from "./logger.js";
import { InMemoryRateLimitStore, type RateLimitStore } from "./rate-limit.js";
import type { Clock } from "./clock.js";
import type { Executor } from "@roonga/qcms-db";

/** Fresh synthetic secret material (32 random bytes → 43-char base64url). */
export function synthSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/** A complete, valid environment with synthetic secrets; override any field. */
export function validEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    DATABASE_URL: "postgres://qcms:synthetic@localhost:5432/qcms_test",
    // One credential per environment (ADR-40, Q2). Synthetic, like every other value
    // here: these are parsed and never dialled, and the pools a test actually uses come
    // from `makeDeps`.
    QCMS_ENVIRONMENTS: "test,prod",
    QCMS_DATABASE_URL_TEST: "postgres://qcms:synthetic@localhost:5432/qcms_test",
    QCMS_DATABASE_URL_PROD: "postgres://qcms:synthetic@localhost:5432/qcms_test",
    QCMS_MOUNT: "all",
    QCMS_LINK_KEYS: synthSecret(),
    QCMS_SESSION_KEYS: synthSecret(),
    QCMS_INTERNAL_TOKEN: synthSecret(),
    QCMS_APP_KEY: synthSecret(),
    QCMS_PORTAL_BASE_URL: "https://forms.example.test",
    // Required because the default mount is `all`, which includes the admin surface
    // and therefore the better-auth instance (task 056). Synthetic, like every other
    // secret here; a test that wants a public-only shape passes QCMS_MOUNT and these
    // become unread.
    QCMS_ADMIN_AUTH_SECRET: synthSecret(),
    QCMS_ADMIN_BASE_URL: "https://admin.example.test",
    // Off in the default test environment, and only here (issue #178). The SEC-1
    // breach check is a live HTTPS call to api.pwnedpasswords.com, so leaving it on
    // by default would make every test that sets a password depend on the internet
    // and on a third party's uptime. The default is pinned as *on* by `config.test.ts`
    // reading a bare environment, and the behaviour it produces is exercised against
    // a stubbed corpus in `features/auth/breached-password.integration.test.ts`;
    // those two are the coverage, not an accidental network call from every other
    // suite.
    QCMS_ADMIN_PASSWORD_BREACH_CHECK: "false",
    // Off in the default test environment, and only here (issue #390). SEC-1's sign-in
    // throttle now defaults to ON everywhere, `NODE_ENV` included, which is the whole
    // point of the change - but its allowance is three attempts per ten seconds across
    // one bucket, and a suite that drives sign-in, sign-up or two-factor more than three
    // times inside a window would start reading 429s as its own failure. That includes
    // the Playwright admin suite, whose API child is built from this helper through
    // `apps/api/e2e/support/harness.ts`.
    //
    // The default is pinned as *on* by `config.test.ts` reading an environment with the
    // variable deleted, the enforcement it produces is driven against a real limiter in
    // `features/auth/sign-in-throttle.test.ts` and
    // `features/auth/sign-in-throttle-state.test.ts`, and the full-stack Compose stack
    // runs it at its shipped default. Those are the coverage, not an incidental 429 in
    // an unrelated suite.
    QCMS_ADMIN_SIGNIN_THROTTLE: "false",
    ...overrides,
  };
}

/** A fixed clock for deterministic tests. */
export function fixedClock(at = new Date("2026-07-20T00:00:00.000Z")): Clock {
  return { now: () => at };
}

export interface TestDepsOverrides {
  /**
   * One handle for every pool.
   *
   * Under ADR-40 a process holds a control pool and one per environment, and which a
   * handler runs on is a privilege decision (see {@link Deps.databases}). A **test**
   * composing an app against one Testcontainers database has one handle and one
   * database, so this fans it out to every pool: the routing is what the unit and
   * integration suites exercise, and the privilege boundary is asserted against real
   * roles in `apps/api/e2e/security/03-db-least-privilege.e2e.ts`, where separate
   * credentials are the point.
   *
   * A test that needs the pools to be genuinely different - to show that a path uses
   * the wrong one - passes {@link TestDepsOverrides.databases} instead.
   */
  readonly db?: Executor;
  /** Supply the pools directly when a test needs them to differ from each other. */
  readonly databases?: Databases;
  readonly config?: Config;
  readonly logger?: Logger;
  readonly clock?: Clock;
  readonly challenge?: ChallengeVerifier;
  /** Supply an assistant when the test drives the 041 assist slice. */
  readonly draftAssistant?: DraftAssistant;
  readonly env?: Record<string, string | undefined>;
  /** Supply a store when the test needs to inspect it (capacity, key count). */
  readonly rateLimitStore?: RateLimitStore;
}

/**
 * Build a {@link Deps} for tests. Supply a `db` (real Drizzle handle for the
 * routes that touch it) or omit it for tests that never call `/ready`.
 */
export function makeDeps(overrides: TestDepsOverrides = {}): Deps {
  const config = overrides.config ?? loadConfig(overrides.env ?? validEnv());
  const clock = overrides.clock ?? fixedClock();
  const one = overrides.db ?? unusedDb();
  return {
    databases: overrides.databases ?? singleDatabase(one, config),
    config,
    clock,
    logger: overrides.logger ?? createNullLogger(),
    rateLimitStore: overrides.rateLimitStore ?? new InMemoryRateLimitStore(clock),
    challenge: overrides.challenge ?? nullChallengeVerifier,
    // Selected from config rather than defaulted to the inert one, so a
    // composition whose env names a provider (the browser harness sets
    // `QCMS_FLAG_AGENT_AUTHORING=fake`) gets the real 041 tool loop without every
    // caller having to wire it. `none` still resolves to the inert assistant.
    draftAssistant:
      overrides.draftAssistant ??
      selectDraftAssistant(config, overrides.logger ?? createNullLogger()),
    flags: config.flags,
  };
}

/**
 * Every pool backed by one handle, for a test with one database.
 *
 * The environment names come from the same configuration the real composition root
 * reads, so a test that sets `QCMS_ENVIRONMENTS` gets those names and
 * `databases.names` is what the schedulers iterate.
 */
export function singleDatabase(exec: Executor, config: Config): Databases {
  return {
    control: exec,
    names: config.environments.map((environment) => environment.name),
    defaultEnvironment: PROD_ENVIRONMENT,
    for: () => exec,
    // The argument is honoured even though every pool is the same handle, because what a
    // handler does with the **name** is real: a reporting read takes it as a parameter, so
    // a suite exercising the Q6 switcher's header would otherwise read `prod`'s views
    // under a `test` header and pass (ADR-40, task 065).
    forRequest: (environment?: string) => ({
      environment: environment ?? PROD_ENVIRONMENT,
      exec,
    }),
  };
}

/**
 * A placeholder db handle for tests that never query it. Any use rejects, so a
 * test that unexpectedly hits the database fails loudly rather than silently.
 */
export function unusedDb(): Executor {
  const handler: ProxyHandler<object> = {
    get() {
      return () => Promise.reject(new Error("test db handle was used unexpectedly"));
    },
  };
  return new Proxy({}, handler) as unknown as Executor;
}

/** The accepted internal token for `validEnv()`-derived config. */
export function internalTokenFor(config: Config): string {
  const first = config.keys.internal[0];
  if (first === undefined) throw new Error("config has no internal token");
  return first;
}

/** A recording logger: captures every emitted line as a parsed object. */
export function recordingLogger(): { logger: Logger; lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  // Reuse the real JSON logger so redaction is exercised, capturing its output.
  const logger = createJsonLogger({
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    now: () => new Date("2026-07-20T00:00:00.000Z"),
  });
  return { logger, lines };
}

/**
 * The real-auth login helper (task 031). Every admin-slice test used to send a
 * made-up marker header that 021's permissive stub accepted; the stub is gone, so
 * a test that wants an authenticated admin request must present a session the
 * middleware can actually verify. This seeds one: a real `user` row (2FA
 * enrollment complete by default, because that is what the `required` policy
 * demands) and a real `session` row, and returns the token to put on
 * `ADMIN_SESSION_HEADER`.
 *
 * It writes the rows directly rather than driving better-auth, deliberately: the
 * API does not link better-auth (see `middleware/admin-auth.ts`), and what these
 * tests exercise is the verifier's contract against stored session state. The
 * browser-level "does better-auth actually issue this row" question is the admin
 * Playwright suite's job, where the real library is in the loop.
 *
 * Timestamps are anchored to `at`, which defaults to {@link fixedClock}'s instant
 * so the seeded session is live under the same clock `makeDeps` gives the app.
 * No password hash is written: nothing here signs in, so no credential exists.
 *
 * # It also seeds the grants, and that is task 069's addition
 *
 * From ADR-41 an authenticated admin session is **necessary and not sufficient**: the
 * installation-wide claim administers and authorises no authoring and no response read
 * anywhere (Q29), so a session alone reaches the membership surface and nothing else. A
 * fixture that seeded only a session would therefore be a fixture that tests the
 * authorisation middleware rather than the slice it is about.
 *
 * So by default this seeds **a full-authority administrator**: a `forms.owner` member row
 * on the installation's first workspace, and the four access groups
 * `all.forms.editor`, `all.forms.approver`, `all.responses.viewer` and
 * `all.responses.eraser` with this account as their holder. That is the shape a
 * single-administrator installation has, which is what most of these suites are about.
 *
 * `grants` narrows it: a list of role names seeds those groups and nothing else, and `[]`
 * seeds the member row's empty role alone - which is the caller criterion 5 and criterion
 * 17 are about, the administrator who reaches nothing. `workspaceId` names the workspace,
 * defaulting to the one the harness seeds.
 */
export async function seedAdminSession(
  exec: Executor,
  options: {
    /** The instant the session is issued at; must match the app's clock. */
    readonly at?: Date;
    /** Idle expiry offset from `at` in ms (default 1h, matching SEC-1). */
    readonly expiresInMs?: number;
    /** Set false to seed an account that has not completed TOTP enrollment. */
    readonly twoFactorEnabled?: boolean;
    /**
     * Set true to seed an account still holding the provisional bootstrap credential
     * (task 061, SEC-1). Default false, which is the state of every account that has
     * changed its password - and therefore of every account these tests are about
     * except the one testing this gate.
     */
    readonly mustChangePassword?: boolean;
    /** Distinguishing suffix when a test needs two different admins. */
    readonly label?: string;
    /**
     * Which roles this account holds, as access groups scoped to `all`.
     *
     * Defaults to every role but `forms.owner`, which is the member row's and is set
     * separately by {@link SeedAdminOptions.owner}. An empty list seeds no access group,
     * so the account holds the member row's empty role and reaches nothing.
     */
    readonly grants?: readonly string[];
    /** Whether the member row carries `forms.owner`. Defaults to true. */
    readonly owner?: boolean;
    /** The workspace the grants are in. Defaults to the installation's first. */
    readonly workspaceId?: string;
    /** Set false to seed no membership at all: no member row and no access group. */
    readonly membership?: boolean;
    /**
     * Whether the account holds the installation-wide SEC-3 claim.
     *
     * Defaults **true**, because `user.role` is declared with the default `admin` and
     * nothing in the product writes a second value, so every account a deployment has
     * today holds it (ADR-41's Note). `false` writes a role that is not `admin`, which is
     * the only thing "no claim" means - the check is an equality on that one value - and
     * it is the shape criterion 5 probes: an administrator with no grant **and no claim**
     * reaches nothing. It is also the shape a deployment issuing a second role value
     * would have.
     */
    readonly claim?: boolean;
  } = {},
): Promise<{ token: string; userId: string }> {
  // Derived from `fixedClock`, not a second copy of the literal: the doc above
  // promises they are the same instant, so changing the clock's default must move
  // this with it rather than silently drift.
  const at = options.at ?? fixedClock().now();
  const label = options.label ?? "editor";
  const userId = `au_${label}_${synthSecret().slice(0, 12)}`;
  const token = `st_${synthSecret()}`;
  await exec.insert(authUser).values({
    id: userId,
    name: `Test ${label}`,
    email: `${label}.${userId}@admin.test`,
    emailVerified: true,
    createdAt: at,
    updatedAt: at,
    twoFactorEnabled: options.twoFactorEnabled ?? true,
    mustChangePassword: options.mustChangePassword ?? false,
    ...(options.claim === false ? { role: NO_CLAIM_ROLE } : {}),
  });
  await exec.insert(authSession).values({
    id: `ss_${synthSecret().slice(0, 16)}`,
    token,
    userId,
    createdAt: at,
    updatedAt: at,
    expiresAt: new Date(at.getTime() + (options.expiresInMs ?? 60 * 60 * 1000)),
  });

  if (options.membership !== false) {
    await seedGrants(exec, {
      userId,
      ...(options.workspaceId === undefined ? {} : { workspaceId: options.workspaceId }),
      ...(options.grants === undefined ? {} : { grants: options.grants }),
      ...(options.owner === undefined ? {} : { owner: options.owner }),
    });
  }
  return { token, userId };
}

/**
 * The `user.role` value an account without the installation claim carries.
 *
 * The claim is an equality on `admin` (`features/membership/resolver.ts`), so "no claim"
 * is any other value and the particular word is arbitrary. It is named rather than
 * written inline so a reader of a fixture can see that the account's lack of the claim is
 * the point rather than a typo.
 */
export const NO_CLAIM_ROLE = "staff";

/** The roles a seeded administrator holds by default: every team role (ADR-41, Q38). */
export const DEFAULT_SEEDED_GRANTS: readonly string[] = [
  "forms.viewer",
  "forms.editor",
  "forms.approver",
  "responses.viewer",
  "responses.eraser",
];

/**
 * Seed one account's membership in one workspace: the member row, and an access group per
 * role scoped to `all`.
 *
 * Written through `@roonga/qcms-db`'s own helpers rather than with raw inserts, so a
 * fixture and the product's write path agree about the shape of a grant - the member row
 * finding G requires, the team's required fields, and the `teamMember` row that **is** the
 * grant (Q32).
 *
 * It writes **no audit row**, deliberately: a fixture is not an act somebody performed,
 * and a seeded `grant` row would make every count-based assertion in the suites start one
 * row behind. The product's write path is what audits, and
 * `membership.integration.test.ts` is where that is asserted.
 */
export async function seedGrants(
  exec: Executor,
  options: {
    readonly userId: string;
    readonly workspaceId?: string;
    readonly grants?: readonly string[];
    readonly owner?: boolean;
  },
): Promise<{ readonly workspaceId: string; readonly teamIds: Record<string, string> }> {
  const workspaces = await listWorkspaces(exec);
  const workspaceId = options.workspaceId ?? workspaces[0]?.id;
  if (workspaceId === undefined) {
    throw new Error(
      "seedGrants needs a workspace: start the harness with its seeded workspace, or pass workspaceId",
    );
  }

  await ensureWorkspaceMember(exec, workspaceId, options.userId);
  if (options.owner !== false) {
    await setMemberRole(exec, workspaceId, options.userId, "forms.owner");
  }

  const teamIds: Record<string, string> = {};
  for (const role of options.grants ?? DEFAULT_SEEDED_GRANTS) {
    const name = `all.${role}`;
    const existing = (await listAccessGroups(exec, workspaceId)).find(
      (group) => group.name === name,
    );
    const group =
      existing ??
      (await createAccessGroup(exec, {
        workspaceId,
        name,
        role,
        environments: ["all"],
        forms: ["all"],
      }));
    await addAccessGroupHolder(exec, group.teamId, options.userId);
    teamIds[role] = group.teamId;
  }
  return { workspaceId, teamIds };
}

export type { MountFlags };
