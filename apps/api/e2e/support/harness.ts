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
import { appGroups } from "../../src/registrars.js";
import { fixedClock, internalTokenFor, makeDeps, validEnv } from "../../src/test-support.js";

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
 * signing keys, the internal token, and the app-encryption key.
 */
export function composeApi(
  db: TestDb["db"],
  env: Record<string, string | undefined>,
  flags: MountFlags,
): ComposedApi {
  const deps = makeDeps({ db, env, clock: fixedClock(NOW) });
  const app = createApp(deps, flags, { groups: appGroups });
  return { app, deps, internalToken: internalTokenFor(deps.config) };
}

export { startTestDb, type TestDb };
