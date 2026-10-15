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
 * Deliberately narrow: the per-environment retention TTLs are task 067's to read, and a
 * helper that returned them would invite a screen to show a value nothing acts on yet.
 * The challenge provider has its own reader below (task 066), for the same reason it is
 * not folded in here: the respondent path wants one column of one row and nothing else.
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
 * retention TTLs beside it in the table stay task 067's.
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
