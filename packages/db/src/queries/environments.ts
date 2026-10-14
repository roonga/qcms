import { asc } from "drizzle-orm";

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
 * Deliberately narrow: the per-environment settings columns (the challenge provider and
 * the two retention TTLs) are tasks 066's and 067's to read, and a helper that returned
 * them would invite a screen to show a value nothing acts on yet.
 */
export async function listEnvironments(exec: Executor): Promise<EnvironmentRow[]> {
  return exec
    .select({ name: environments.name, position: environments.position })
    .from(environments)
    .orderBy(asc(environments.position));
}
