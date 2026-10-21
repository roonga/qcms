import { asc, eq } from "drizzle-orm";

import { environments } from "../schema/index.js";
import type { Executor } from "./executor.js";

/** One row of the live environment set. */
export interface EnvironmentRow {
  readonly name: string;
  readonly position: number;
}

/**
 * The live environment set, in `position` order (ADR-40, Q1, Q42).
 *
 * **This table is the source of the set**, which is why this read exists rather than the
 * caller listing the pools it happens to hold: `position` is the canonical order a
 * combined environment set is written in (Q42), and the admin's Q6 switcher offers the
 * environments in that order so the operator sees one ordering everywhere.
 *
 * Every application role holds `SELECT` here and nothing else, so this read works on the
 * control pool and on every environment pool.
 *
 * Deliberately narrow, and each of the other two columns has its own reader below for the
 * same reason: a caller wants one of them and would otherwise be handed three. The
 * challenge provider is read one environment at a time by the respondent path (task 066);
 * the retention TTLs are read for the whole set at once by the sweep (task 067), because
 * one pass covers every environment.
 */
export async function listEnvironments(exec: Executor): Promise<EnvironmentRow[]> {
  return exec
    .select({ name: environments.name, position: environments.position })
    .from(environments)
    .orderBy(asc(environments.position));
}

/**
 * One environment's challenge provider, or `null` to use the installation-wide typed
 * value (Q11, ADR-24's amendment, task 066).
 *
 * `undefined` means there is no such environment row at all, which a caller distinguishes
 * from `null`: the first is a configuration fault and the second is the ordinary case.
 *
 * Read on the **environment** pool, by the respondent path, when a form carries
 * `challengeRequired`. It holds `SELECT` on `control.environments` (Q48's read list), so
 * this needs no grant of its own.
 *
 * A column of its own rather than part of {@link listEnvironments}: a test environment
 * that asks a tester to solve a visible challenge is a cost with no benefit, which is the
 * whole of the setting, and the respondent path reads it one environment at a time. The
 * retention TTLs beside it in the table are {@link listEnvironmentRetention}'s.
 */
export async function getEnvironmentChallengeProvider(
  exec: Executor,
  name: string,
): Promise<string | null | undefined> {
  const [row] = await exec
    .select({ challengeProvider: environments.challengeProvider })
    .from(environments)
    .where(eq(environments.name, name))
    .limit(1);
  return row === undefined ? undefined : row.challengeProvider;
}

/**
 * One environment's retention TTL overrides, in milliseconds, or `null` where the
 * installation-wide typed value stands (Q11, ADR-24's amendment, task 067).
 *
 * **Which TTLs these are is the narrow set ADR-24 was amended to name, and not one
 * more.** The two retention windows are here because a test environment that keeps a
 * consumer's response body for seven days, or a second copy of a tester's answers for
 * thirty, is a cost with no benefit. The **session TTL is not**, and that is a decision
 * rather than an omission (Q11, finding 6): it stays installation-wide with the rate
 * limits, the anti-abuse thresholds and every other typed setting, because a
 * per-environment limiter inside one process would be a second place for the
 * replica-count caveat of issue #488 to be got wrong.
 */
export interface EnvironmentRetentionRow {
  readonly name: string;
  /** Overrides `QCMS_DELIVERY_SNIPPET_TTL_MS`, or `null` to use it. */
  readonly deliverySnippetTtlMs: number | null;
  /** Overrides `QCMS_OUTBOX_PAYLOAD_TTL_MS`, or `null` to use it. */
  readonly outboxPayloadTtlMs: number | null;
}

/**
 * Every environment's retention TTL overrides, in `position` order (Q11, task 067).
 *
 * The whole set in one read rather than one read per environment: the retention sweep is
 * one pass over the live set, and a query per environment would be N round trips for two
 * numbers each. It runs on the **control** pool, which is the connection the sweep holds
 * before it picks an environment, and every application role holds `SELECT` on this table
 * anyway (Q48's read list), so it needs no grant of its own.
 *
 * `null` and **absent** mean different things, and only the first is ordinary. `null` is
 * "this environment has no override", which is what every row is created with; a missing
 * row would be a configuration fault, and the boot check of task 064's criterion 6a
 * already refuses the process for one, so a caller iterating the live set never meets it.
 */
export async function listEnvironmentRetention(exec: Executor): Promise<EnvironmentRetentionRow[]> {
  return exec
    .select({
      name: environments.name,
      deliverySnippetTtlMs: environments.deliverySnippetTtlMs,
      outboxPayloadTtlMs: environments.outboxPayloadTtlMs,
    })
    .from(environments)
    .orderBy(asc(environments.position));
}
