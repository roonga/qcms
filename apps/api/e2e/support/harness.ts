/**
 * Composition helpers for the e2e suite (task 027).
 *
 * The scenarios drive the product as a *consumer*: they compose the app exactly
 * as `serve.ts` does (`createApp(deps, flags, { groups: appGroups })`) and then
 * speak only HTTP (`app.request(...)`) and the seed toolkit. Nothing here
 * reaches into a slice's internals.
 *
 * **One env, one database, many compositions.** `validEnv()` regenerates its
 * synthetic secrets on every call, so a topology that spans two process shapes
 * sharing tokens (scenario 4: a public-only respondent process and a separate
 * internal/admin authoring process over one database) must build the env **once**
 * and hand the same object to every composition. `buildEnv()` is that single
 * call; `composeApi(db, env, flags)` turns (db, env, shape) into a running app.
 */

import { startTestDb, type TestDb } from "@qcms/db/testing";

import { createApp } from "../../src/app.js";
import type { Deps } from "../../src/deps.js";
import type { MountFlags } from "../../src/config.js";
import type { Logger } from "../../src/logger.js";
import { appGroups } from "../../src/registrars.js";
import {
  fixedClock,
  internalTokenFor,
  makeDeps,
  seedAdminSession,
  validEnv,
} from "../../src/test-support.js";

/** The fixed wall-clock the suite pins for deterministic tokens/timestamps. */
export const NOW = new Date("2026-07-20T00:00:00.000Z");

/** Process-shape presets (ADR-09). */
export const MOUNT = {
  all: { public: true, internal: true, admin: true },
  publicOnly: { public: true, internal: false, admin: false },
  adminOnly: { public: false, internal: true, admin: true },
} as const satisfies Record<string, MountFlags>;

/**
 * Build the shared environment **once**. Enables private webhook targets so the
 * in-test loopback receiver is reachable (SEC-6 on-prem override); every other
 * secret is synthetic. Reuse the returned object across compositions that must
 * share tokens - never call this twice for one topology.
 */
export function buildEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return validEnv({ QCMS_WEBHOOK_ALLOW_PRIVATE: "true", ...overrides });
}

/** A composed API app plus the pieces scenarios need to talk to it. */
export interface ComposedApi {
  readonly app: ReturnType<typeof createApp>;
  readonly deps: Deps;
  /** The accepted internal service token for this composition's config. */
  readonly internalToken: string;
}

/**
 * Compose an app for a given database, environment, and process shape. The clock
 * is pinned to {@link NOW}. Every composition built from the same `env` shares
 * signing keys, the internal token, and the app-encryption key. An optional
 * `logger` override lets a harness capture the API's structured log stream (the
 * portal e2e's server-side log gate writes it to a file, task 045); when omitted
 * the default null logger is used, so existing scenarios are unaffected.
 */
export function composeApi(
  db: TestDb["db"],
  env: Record<string, string | undefined>,
  flags: MountFlags,
  opts: { logger?: Logger } = {},
): ComposedApi {
  const deps = makeDeps({
    db,
    env,
    clock: fixedClock(NOW),
    ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
  });
  const app = createApp(deps, flags, { groups: appGroups });
  return { app, deps, internalToken: internalTokenFor(deps.config) };
}

/**
 * The real-auth login helper the 027 suite gained in task 031.
 *
 * Before 031 an admin request carried a made-up marker header that the launch
 * stub accepted unconditionally. The stub is gone: the admin-auth middleware now
 * resolves the header against a real `session` row. This is the one call a
 * scenario makes to become an authenticated admin - seed a 2FA-enrolled admin
 * account and a live session, and hand the returned token to
 * {@link AdminClient}. Anchored to {@link NOW} so it is live under the same
 * pinned clock every composition here uses.
 *
 * It is not a browser sign-in and does not pretend to be: the full
 * password + TOTP + recovery-code loop through better-auth is the admin
 * Playwright suite's subject (`apps/admin/e2e`). What this covers is the API's
 * side of the contract - a real session row, verified by the real middleware.
 */
export async function adminLogin(db: TestDb["db"], at: Date = NOW): Promise<string> {
  const { token } = await seedAdminSession(db, { at });
  return token;
}

export { startTestDb, type TestDb };
