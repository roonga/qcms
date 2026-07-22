/**
 * Canonical `insurance` fixtures for the e2e suite (task 027).
 *
 * The suite reuses the kernel's committed fixtures - the same `insurance` form
 * the slice integration tests use - so the scenarios exercise the real branching
 * shape (one step `stp_history`; `q_accident_count` shown only when `q_at_fault_accident = true`)
 * rather than a bespoke fixture. The compiled A2UI is the committed golden
 * document (ADR-18): the seed path stores it verbatim, and scenario 1 proves the
 * *server* produces the same bytes when it compiles the draft at publish time.
 */

import { readFileSync } from "node:fs";

const REPO_ROOT = new URL("../../../../", import.meta.url);

function readFixture(relative: string): unknown {
  return JSON.parse(readFileSync(new URL(relative, REPO_ROOT), "utf8"));
}

/** The `insurance` form definition (plain-JSON FormDefinition, pins q_at_fault_accident@2, q_accident_count@1). */
export const INSURANCE_DEF = readFixture("packages/core/fixtures/forms/valid/insurance.json");

/** `q_at_fault_accident` - boolean, required. */
export const Q_ACCIDENT_DEF = readFixture("packages/core/fixtures/questions/valid/boolean.json");

/** `q_accident_count` - number 0..200 integer, required. */
export const Q_ACCIDENT_COUNT_DEF = readFixture(
  "packages/core/fixtures/questions/valid/number.json",
);

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

// --- kitchen-sink: all seven question types across three steps (task 045) ----

/**
 * The `kitchen-sink` form: three steps exercising every question type - short
 * text, date, boolean, number, multi-choice, long text, single choice - with two
 * branch rules (`q_accident_count` shown when `q_at_fault_accident=true`;
 * `q_extra_detail` shown when an optional-cover option is selected). It is the
 * fixture the portal's explicit-navigation e2e drives (ADR-28).
 *
 * The form is VEHICLE-domain throughout (043's neutral-domain rule): the two
 * questions unique to this form (optional-cover multi-choice, extra-detail long
 * text) live in this support directory rather than the shared kernel fixtures,
 * whose bytes are frozen by the golden corpus. The compiled golden is generated
 * from these definitions via the a2ui-compiler and committed alongside them.
 */
export const KITCHEN_SINK_DEF = readFixture("apps/api/e2e/support/fixtures/kitchen-sink-form.json");

/** `q_full_name` - short text, required (stp_about). */
export const Q_FULL_NAME_DEF = readFixture(
  "packages/core/fixtures/questions/valid/short-text.json",
);
/** `q_dob` - date, required (stp_about). */
export const Q_DOB_DEF = readFixture("packages/core/fixtures/questions/valid/date.json");
/** `q_optional_cover` - multi-choice, required, 1..3 selected (stp_history). */
export const Q_OPTIONAL_COVER_DEF = readFixture(
  "apps/api/e2e/support/fixtures/q-optional-cover.json",
);
/** `q_extra_detail` - long text, optional (stp_history, shown by branch). */
export const Q_EXTRA_DETAIL_DEF = readFixture("apps/api/e2e/support/fixtures/q-extra-detail.json");
/** `q_coverage_level` - single choice, required (stp_cover). */
export const Q_COVERAGE_DEF = readFixture(
  "packages/core/fixtures/questions/valid/single-choice.json",
);

/** The committed golden compiled A2UI document for the kitchen-sink form. */
export const KITCHEN_SINK_GOLDEN = readFixture(
  "apps/api/e2e/support/fixtures/kitchen-sink.a2ui.json",
) as CompiledForm;
