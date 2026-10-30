// Every secret here is synthetic and generated in-test: no real secret enters a fixture.

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
import { selectDraftAssistant } from "./features/agent/assistant.js";
import type { DraftAssistant } from "./features/agent/types.js";
import { type ChallengeVerifier, nullChallengeVerifier } from "./features/responses/challenge.js";
import { createJsonLogger, createNullLogger, type Logger } from "./logger.js";
import { InMemoryRateLimitStore, type RateLimitStore } from "./rate-limit.js";
import type { Clock } from "./clock.js";
import type { Executor } from "@roonga/qcms-db";

export function synthSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function validEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    DATABASE_URL: "postgres://qcms:synthetic@localhost:5432/qcms_test",
    QCMS_ENVIRONMENTS: "test,prod",
    QCMS_DATABASE_URL_TEST: "postgres://qcms:synthetic@localhost:5432/qcms_test",
    QCMS_DATABASE_URL_PROD: "postgres://qcms:synthetic@localhost:5432/qcms_test",
    QCMS_MOUNT: "all",
    QCMS_LINK_KEYS: synthSecret(),
    QCMS_SESSION_KEYS: synthSecret(),
    QCMS_INTERNAL_TOKEN: synthSecret(),
    QCMS_APP_KEY: synthSecret(),
    QCMS_PORTAL_BASE_URL: "https://forms.example.test",
    QCMS_ADMIN_AUTH_SECRET: synthSecret(),
    QCMS_ADMIN_BASE_URL: "https://admin.example.test",
    // Off here only: the SEC-1 breach check is a live HTTPS call, so leaving it on would
    // make every test that sets a password depend on a third party. `config.test.ts` pins
    // the shipped default as on.
    QCMS_ADMIN_PASSWORD_BREACH_CHECK: "false",
    // Off here only: the throttle allows three attempts per ten seconds in one bucket, so
    // a suite driving sign-in more than that would read 429s as its own failure.
    // `config.test.ts` pins the shipped default as on.
    QCMS_ADMIN_SIGNIN_THROTTLE: "false",
    ...overrides,
  };
}

export function fixedClock(at = new Date("2026-07-20T00:00:00.000Z")): Clock {
  return { now: () => at };
}

export interface TestDepsOverrides {
  /**
   * One handle fanned out to every pool, for a test with one database. The privilege
   * boundary between the real per-environment pools is asserted in
   * `apps/api/e2e/security/03-db-least-privilege.e2e.ts`; a test that needs the pools to
   * differ passes {@link TestDepsOverrides.databases} instead.
   */
  readonly db?: Executor;
  readonly databases?: Databases;
  readonly config?: Config;
  readonly logger?: Logger;
  readonly clock?: Clock;
  readonly challenge?: ChallengeVerifier;
  readonly draftAssistant?: DraftAssistant;
  readonly env?: Record<string, string | undefined>;
  readonly rateLimitStore?: RateLimitStore;
}

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
    // Selected from config, so a composition whose env names a provider gets the real tool
    // loop without every caller wiring it.
    draftAssistant:
      overrides.draftAssistant ??
      selectDraftAssistant(config, overrides.logger ?? createNullLogger()),
    flags: config.flags,
  };
}

export function singleDatabase(exec: Executor, config: Config): Databases {
  return {
    control: exec,
    names: config.environments.map((environment) => environment.name),
    defaultEnvironment: PROD_ENVIRONMENT,
    for: () => exec,
    // The argument is honoured even though every pool is the same handle: a reporting read
    // takes the name as a parameter, so a suite exercising the environment switcher would
    // otherwise read `prod`'s views under a `test` header and pass.
    forRequest: (environment?: string) => ({
      environment: environment ?? PROD_ENVIRONMENT,
      exec,
    }),
  };
}

/** Any use rejects, so a test that unexpectedly hits the database fails loudly. */
export function unusedDb(): Executor {
  const handler: ProxyHandler<object> = {
    get() {
      return () => Promise.reject(new Error("test db handle was used unexpectedly"));
    },
  };
  return new Proxy({}, handler) as unknown as Executor;
}

export function internalTokenFor(config: Config): string {
  const first = config.keys.internal[0];
  if (first === undefined) throw new Error("config has no internal token");
  return first;
}

export function recordingLogger(): { logger: Logger; lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  // The real JSON logger, so redaction is exercised rather than bypassed.
  const logger = createJsonLogger({
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    now: () => new Date("2026-07-20T00:00:00.000Z"),
  });
  return { logger, lines };
}

/**
 * Writes rows directly because the API does not link better-auth; no password hash, so no
 * credential. Seeds a full-authority administrator by default: under ADR-41 a session alone
 * reaches only the membership surface.
 */
export async function seedAdminSession(
  exec: Executor,
  options: {
    /** Must match the app's clock, or the seeded session is not live. */
    readonly at?: Date;
    readonly expiresInMs?: number;
    readonly twoFactorEnabled?: boolean;
    /** True seeds an account still holding the provisional bootstrap credential. */
    readonly mustChangePassword?: boolean;
    readonly label?: string;
    /** An empty list seeds no access group, so the account reaches nothing. */
    readonly grants?: readonly string[];
    readonly owner?: boolean;
    readonly workspaceId?: string;
    readonly membership?: boolean;
    /**
     * `false` writes a role that is not `admin`, which is the only thing "no claim" means:
     * the SEC-3 check is an equality on that one value.
     */
    readonly claim?: boolean;
  } = {},
): Promise<{ token: string; userId: string }> {
  // Derived from `fixedClock` rather than a second copy of the literal, so changing the
  // clock's default moves this with it.
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
 * The claim is an equality on `admin`, so any other value means no claim and this
 * particular word is arbitrary.
 */
export const NO_CLAIM_ROLE = "staff";

export const DEFAULT_SEEDED_GRANTS: readonly string[] = [
  "forms.viewer",
  "forms.editor",
  "forms.approver",
  "responses.viewer",
  "responses.eraser",
];

/**
 * Written through `@roonga/qcms-db`'s own helpers rather than raw inserts, so a fixture and
 * the product's write path agree about the shape of a grant.
 *
 * It writes no audit row: a fixture is not an act somebody performed, and a seeded one
 * would leave every count-based assertion a row behind.
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
