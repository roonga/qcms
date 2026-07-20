/**
 * Canonical `insurance` fixtures for the e2e suite (task 027).
 *
 * The suite reuses the kernel's committed fixtures - the same `insurance` form
 * the slice integration tests use - so the scenarios exercise the real branching
 * shape (one step `stp_health`; `q_cigs_daily` shown only when `q_smoker = true`)
 * rather than a bespoke fixture. The compiled A2UI is the committed golden
 * document (ADR-18): the seed path stores it verbatim, and scenario 1 proves the
 * *server* produces the same bytes when it compiles the draft at publish time.
 */

import { readFileSync } from "node:fs";

const REPO_ROOT = new URL("../../../../", import.meta.url);

function readFixture(relative: string): unknown {
  return JSON.parse(readFileSync(new URL(relative, REPO_ROOT), "utf8"));
}

/** The `insurance` form definition (plain-JSON FormDefinition, pins q_smoker@2, q_cigs_daily@1). */
export const INSURANCE_DEF = readFixture("packages/core/fixtures/forms/valid/insurance.json");

/** `q_smoker` - boolean, required. */
export const Q_SMOKER_DEF = readFixture("packages/core/fixtures/questions/valid/boolean.json");

/** `q_cigs_daily` - number 0..200 integer, required. */
export const Q_CIGS_DEF = readFixture("packages/core/fixtures/questions/valid/number.json");

/** The committed golden compiled A2UI document for the insurance form. */
export interface CompiledDoc {
  readonly stepId: string;
  readonly root: unknown;
}
export interface CompiledForm {
  readonly documents: readonly CompiledDoc[];
  readonly compilerVersion: string;
  readonly a2uiSpecVersion: string;
}
export const INSURANCE_GOLDEN = readFixture(
  "packages/a2ui-compiler/golden/v1/insurance.a2ui.json",
) as CompiledForm;
