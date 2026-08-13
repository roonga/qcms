/**
 * Test-only fixtures (task 017). Excluded from the published build
 * (`tsconfig.build.json`) - never shipped, never imported by runtime code.
 *
 * Secrets here are **synthetic, generated in-test** (SEC: no real secret ever
 * enters a fixture). `synthSecret()` returns fresh random base64url material at
 * or above the config minimum length.
 */

import { authSession, authUser } from "@qcms/db";

import type { Config, MountFlags } from "./config.js";
import { loadConfig } from "./config.js";
import type { Deps } from "./deps.js";
import { selectDraftAssistant } from "./features/forms/assist/assistant.js";
import type { DraftAssistant } from "./features/forms/assist/types.js";
import { type ChallengeVerifier, nullChallengeVerifier } from "./features/responses/challenge.js";
import { createJsonLogger, createNullLogger, type Logger } from "./logger.js";
import { InMemoryRateLimitStore, type RateLimitStore } from "./rate-limit.js";
import type { Clock } from "./clock.js";
import type { Executor } from "@qcms/db";

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
  readonly db?: Executor;
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
  return {
    db: overrides.db ?? unusedDb(),
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
      overrides.draftAssistant ?? selectDraftAssistant(config, overrides.logger ?? createNullLogger()),
    flags: config.flags,
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
    /** Distinguishing suffix when a test needs two different admins. */
    readonly label?: string;
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
  });
  await exec.insert(authSession).values({
    id: `ss_${synthSecret().slice(0, 16)}`,
    token,
    userId,
    createdAt: at,
    updatedAt: at,
    expiresAt: new Date(at.getTime() + (options.expiresInMs ?? 60 * 60 * 1000)),
  });
  return { token, userId };
}

export type { MountFlags };
