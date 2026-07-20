/**
 * Test-only fixtures (task 017). Excluded from the published build
 * (`tsconfig.build.json`) — never shipped, never imported by runtime code.
 *
 * Secrets here are **synthetic, generated in-test** (SEC: no real secret ever
 * enters a fixture). `synthSecret()` returns fresh random base64url material at
 * or above the config minimum length.
 */

import type { Config, MountFlags } from "./config.js";
import { loadConfig } from "./config.js";
import type { Deps } from "./deps.js";
import { createJsonLogger, createNullLogger, type Logger } from "./logger.js";
import { InMemoryRateLimitStore } from "./rate-limit.js";
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
  readonly env?: Record<string, string | undefined>;
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
    rateLimitStore: new InMemoryRateLimitStore(clock),
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

export type { MountFlags };
