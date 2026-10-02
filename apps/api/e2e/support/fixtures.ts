/**
 * Canonical `insurance` fixtures for the e2e suite (task 027).
 *
 * The suite reuses the kernel's committed fixtures - the same `insurance` form
 * the slice integration tests use - so the scenarios exercise the real branching
 * shape (one step `stp_history`; `q_accident_count` shown only when `q_at_fault_accident = true`)
 * rather than a bespoke fixture. The compiled A2UI is the committed golden
 * document (ADR-18): the seed path stores it verbatim, exactly as the serve path
 * later replays it.
 *
 * Storing bytes verbatim is only sound while they are the bytes the compiler
 * still emits, and nothing checked that until issue #321: scenario 1 republishes
 * the insurance form over HTTP but asserts only the A2UI spec stamp, not the
 * document. `fixture-drift.test.ts` is the anchor now - it recompiles every entry
 * in {@link COMPILED_FIXTURES} through the real publish path and fails on any
 * divergence from the committed file.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { COMPILER_VERSION } from "@roonga/qcms-a2ui-compiler";

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

const GOLDEN_ROOT = new URL("packages/a2ui-compiler/golden/", REPO_ROOT);

/**
 * Which A2UI corpus generation the LIVE compiler produces (issue #321).
 *
 * The corpus is append-only (ADR-18): a compiler change that alters existing
 * output bumps `COMPILER_VERSION` and seeds a NEW `golden/vN/` directory beside
 * the old ones, which stay committed forever as the record of what each earlier
 * compiler emitted (`packages/a2ui-compiler/golden/README.md`). This suite wants
 * the current one, and a hardcoded path segment cannot express that: this read
 * named `golden/v1/` (compiler `0.0.0`) while the live compiler was already on
 * `0.1.0` and emitting into `golden/v2/`, so the whole e2e suite anchored on a
 * shape the compiler had stopped producing, with nothing failing to say so.
 *
 * So the segment is derived from the compiler rather than written down: newest
 * generation first, take the one whose committed `insurance.a2ui.json` carries
 * this compiler's own `COMPILER_VERSION` stamp. A future `v3/` is picked up with
 * no edit here, and a `COMPILER_VERSION` bump landed WITHOUT its generation
 * throws at load rather than quietly reverting to the previous generation's
 * bytes. `fixture-drift.test.ts` then proves the selected document is what this
 * compiler emits today, byte for byte.
 */
function currentGoldenGeneration(): string {
  const generations = readdirSync(fileURLToPath(GOLDEN_ROOT), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number(right.slice(1)) - Number(left.slice(1)));
  for (const generation of generations) {
    const candidate = new URL(`${generation}/insurance.a2ui.json`, GOLDEN_ROOT);
    if (!existsSync(fileURLToPath(candidate))) continue;
    // Cast: a committed corpus document, already asserted spec-valid by the
    // compiler's own golden tests; only its version stamp is read here.
    const document = JSON.parse(readFileSync(candidate, "utf8")) as CompiledForm;
    if (document.compilerVersion === COMPILER_VERSION) return generation;
  }
  throw new Error(
    `no generation under packages/a2ui-compiler/golden/ has an insurance.a2ui.json stamped ` +
      `compilerVersion ${COMPILER_VERSION}. A compiler version bump seeds its own generation ` +
      `directory first (packages/a2ui-compiler/golden/README.md, spec-bump procedure).`,
  );
}

/** Repo-relative path of the insurance golden this compiler generation owns. */
export const INSURANCE_GOLDEN_PATH = `packages/a2ui-compiler/golden/${currentGoldenGeneration()}/insurance.a2ui.json`;

export const INSURANCE_GOLDEN = readFixture(INSURANCE_GOLDEN_PATH) as CompiledForm;

// --- vehicle-kitchen-sink: every question type across three steps (task 045) --

/**
 * The **vehicle** kitchen-sink form: three steps exercising every question type -
 * short text, date, boolean, number, multi-choice, long text, single choice -
 * with two branch rules (`q_accident_count` shown when `q_at_fault_accident=true`;
 * `q_extra_detail` shown when an optional-cover option is selected). It is the
 * fixture the portal's explicit-navigation e2e drives (ADR-28).
 *
 * It also carries each question type in the state a no-JS browser case needs to
 * reach, in REQUIRED / OPTIONAL pairs where the clear matters: `q_accident_count` is
 * a required number and `q_annual_km` an optional one, `q_body_type` a required
 * single choice above the compiler's option threshold and `q_overnight_parking` an
 * optional one. On that path browser validation decides which gestures are reachable
 * at all - a required field cannot be emptied, so each clear needs the optional half
 * of its pair (see `Q_ANNUAL_KM_DEF` and `Q_OVERNIGHT_PARKING_DEF`).
 *
 * The single-choice pair is also the only place any fixture or golden document
 * compiles a `Select` at all: every other single-choice question has four options,
 * below `SINGLE_CHOICE_SELECT_THRESHOLD`, which is what kept issue #988's no-JS dead
 * end unobserved while every gate stayed green over it.
 *
 * The form is VEHICLE-domain throughout (043's neutral-domain rule): the five
 * questions unique to this form (optional-cover multi-choice, extra-detail long
 * text, annual-km number, body-type and overnight-parking single choice) live in
 * this support directory rather than the shared kernel fixtures, whose bytes are
 * frozen by the golden corpus. The compiled golden is generated from these
 * definitions via the a2ui-compiler and committed alongside them.
 *
 * **`vehicle-` is load-bearing, not decoration (issue #129).** A different form
 * with the same coverage and a DIFFERENT question set - the health-domain
 * `kitchen-sink` in `packages/core/fixtures/forms/valid/`, compiled into
 * `packages/a2ui-compiler/golden/vN/kitchen-sink.a2ui.json` - used to share this
 * one's file name. Element lookups written against one form's question ids and
 * run against the other do not error; they simply find nothing, which reads as a
 * broken assertion rather than a wrong fixture, and cost a full test-authoring
 * cycle in issue #98. The golden corpus is append-only (ADR-18), so this side is
 * the one that could move. See `apps/api/e2e/support/fixtures/README.md`.
 */
export const KITCHEN_SINK_DEF = readFixture(
  "apps/api/e2e/support/fixtures/vehicle-kitchen-sink-form.json",
);

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
/**
 * `q_annual_km` - number, **optional**, integer 0..100000 (stp_cover).
 *
 * The one optional number in any fixture form, added for issue #18: the ruling
 * (2026-09-19) asks for a browser case in which a no-JS respondent CLEARS a number
 * they answered earlier, and a required one cannot be cleared through the browser -
 * HTML `required` refuses the empty submit before the form leaves the page, which is
 * the 2026-09-13 ruling on issue #920 working as intended. So the clear needs an
 * optional number, and `q_accident_count` is required.
 *
 * Deliberately INTEGER (`step: 1` once compiled). A question that admits fractions
 * would leave the scripted control on react-aria's default format, whose three
 * fraction digits are what makes `inputMode` disagree between a server render and a
 * touch client - the open half of issue #945. Adding one to a seeded fixture would
 * put that mismatch on a page the browser gate reloads under its console gate, which
 * is making #945 worse rather than leaving it alone.
 *
 * Appended to `stp_cover` AFTER `q_coverage_level`, so the single-choice RadioGroup
 * keeps the tree position `a11y-keyboard.pw.ts` relies on for its issue #144 case.
 */
export const Q_ANNUAL_KM_DEF = readFixture("apps/api/e2e/support/fixtures/q-annual-km.json");

/**
 * `q_body_type` - single choice, **required**, NINE options (stp_cover).
 *
 * The first question in any fixture form that compiles to a `Select`. A
 * `singleChoice` question renders as a `RadioGroup` at seven options or fewer and
 * as a `Select` above that (`SINGLE_CHOICE_SELECT_THRESHOLD`,
 * `packages/a2ui-compiler/src/mapping.ts`), and every other single-choice question
 * in every fixture and in the golden corpus has four - which is exactly why the
 * no-JS dead end issue #988 records went unobserved while every gate stayed green
 * over it. Nine rather than eight so the threshold is cleared by more than a
 * rounding error's worth of options.
 *
 * REQUIRED, because the defect's worst shape is the required one: the vendored
 * control's real `<select>` is unfocusable, so the browser could not report its
 * validity and abandoned the whole step's submission, which made every step behind
 * the question unreachable without scripting.
 *
 * Appended to `stp_cover` AFTER `q_coverage_level` and `q_annual_km`, for the reason
 * `Q_ANNUAL_KM_DEF` above records: the single-choice RadioGroup keeps the tree
 * position `a11y-keyboard.pw.ts` relies on for its issue #144 case.
 */
export const Q_BODY_TYPE_DEF = readFixture("apps/api/e2e/support/fixtures/q-body-type.json");

/**
 * `q_overnight_parking` - single choice, **optional**, eight options (stp_cover).
 *
 * The `Select` counterpart of `Q_ANNUAL_KM_DEF`, and it exists for the same reason
 * (issue #988): the clear case needs an OPTIONAL question, because a required one
 * cannot be emptied through the browser at all - HTML `required` refuses the empty
 * submit before the form leaves the page, which is the 2026-09-13 ruling on issue
 * #920 working as intended.
 *
 * What it buys is a gesture that did not exist: `docs/COMPONENT_GUIDELINES.md`
 * records that a chosen Select option cannot be deselected, which is still true of
 * the scripted control, and the no-JS rendering's empty-valued placeholder option
 * can be returned to. So an answered optional single-choice question can be cleared
 * on this path, and the clear reaches the API as the ADR-33 retraction every other
 * cleared field produces (issue #127).
 */
export const Q_OVERNIGHT_PARKING_DEF = readFixture(
  "apps/api/e2e/support/fixtures/q-overnight-parking.json",
);

/** Repo-relative path of the compiled document (regenerable, see below). */
export const KITCHEN_SINK_COMPILED_PATH =
  "apps/api/e2e/support/fixtures/vehicle-kitchen-sink.a2ui.json";

/** The committed compiled A2UI document for the vehicle kitchen-sink form. */
export const KITCHEN_SINK_GOLDEN = readFixture(KITCHEN_SINK_COMPILED_PATH) as CompiledForm;

// --- author-messages: ADR-32 messages + ADR-36 boolean labels (task 048) -----

/**
 * The `author-messages` form: one step whose four required questions exercise
 * author-supplied validation messages (ADR-32) and boolean label overrides
 * (ADR-36) end to end in the browser.
 *
 * A SEPARATE form rather than messages retrofitted onto the kitchen-sink fixture
 * (task 048 is explicit about appending instead): the kitchen-sink compiled golden
 * is asserted byte-for-byte by several specs, and its bytes staying still is part
 * of what proves both features additive.
 *
 * What each question is here for:
 * - `q_am_plate` - three custom messages (required, minLength, pattern), so two
 *   different constraints on one question show two different authored sentences.
 * - `q_am_vin` - carries the IDENTICAL custom `required` text as the plate, the
 *   case WCAG 3.3.1 distinctness exists for (issue #21, ADR-32), AND a
 *   deliberately un-decorated `minLength`, which is what makes the fallback
 *   provably per constraint rather than per question. `minLength` and not
 *   `maxLength`: the compiler forwards `maxLength` as the input's advisory
 *   `maxlength` attribute, so the control truncates the value and a browser can
 *   never provoke that constraint at all.
 * - `q_am_tows` - both boolean labels overridden.
 * - `q_am_garaged` - one label overridden, the other on the lexicon (mixed pair).
 *
 * Vehicle domain throughout (043's neutral-domain rule, guarded by
 * `scripts/check-fixture-domain.mjs`). The compiled golden is generated from these
 * definitions via the a2ui-compiler and committed alongside them.
 */
export const AUTHOR_MESSAGES_DEF = readFixture(
  "apps/api/e2e/support/fixtures/author-messages-form.json",
);

/** The four question definitions the `author-messages` form pins. */
export const AUTHOR_MESSAGES_QUESTIONS: readonly {
  readonly questionId: string;
  readonly slug: string;
  readonly definition: unknown;
}[] = [
  {
    questionId: "q_am_plate",
    slug: "am-plate",
    definition: readFixture("apps/api/e2e/support/fixtures/q-am-plate.json"),
  },
  {
    questionId: "q_am_vin",
    slug: "am-vin",
    definition: readFixture("apps/api/e2e/support/fixtures/q-am-vin.json"),
  },
  {
    questionId: "q_am_tows",
    slug: "am-tows",
    definition: readFixture("apps/api/e2e/support/fixtures/q-am-tows.json"),
  },
  {
    questionId: "q_am_garaged",
    slug: "am-garaged",
    definition: readFixture("apps/api/e2e/support/fixtures/q-am-garaged.json"),
  },
];

/** Repo-relative path of the `author-messages` compiled document (regenerable, see below). */
export const AUTHOR_MESSAGES_COMPILED_PATH =
  "apps/api/e2e/support/fixtures/author-messages.a2ui.json";

/** The committed golden compiled A2UI document for the `author-messages` form. */
export const AUTHOR_MESSAGES_GOLDEN = readFixture(AUTHOR_MESSAGES_COMPILED_PATH) as CompiledForm;

// --- repeat-fleet: a repeating group on the respondent surface (task 073) ----

/**
 * The `repeat-fleet` form: one step holding a plain required question and one
 * **repeating group** whose count source is `open`, `min: 1`, `max: 3` (ADR-42, ADR-43).
 *
 * It is the fixture the portal's repeat specs drive, on both paths. Its four members are
 * chosen for what they let a browser assert rather than for coverage's own sake:
 *
 * - `q_rf_plate` is **required**, so the Add button's `formnovalidate` is load-bearing
 *   (a respondent who has not filled vehicle 1 must still be able to add vehicle 2), and
 *   so the ruled "an Add post writes no answer and retracts nothing" has a required
 *   field to prove it against;
 * - `q_rf_service_date` is an optional **date**, which on the no-JS path renders the
 *   native date fallback (issue #920), so a repeated instance is proved to reach that
 *   substitution too;
 * - `q_rf_notes` is a **longText** and `q_rf_extras` a **multiChoice**, which is
 *   acceptance case 38: the stacked presentation allows every question type, and these
 *   are the two the table presentation refuses (Q12's deliberate asymmetry).
 *
 * `max: 3` keeps the refusal one press away from the second add, and `min: 1` means the
 * first serve mints a card rather than showing an empty group with a button.
 *
 * Vehicle domain throughout (043's neutral-domain rule, guarded by
 * `scripts/check-fixture-domain.mjs`). The compiled golden is generated from these
 * definitions via the a2ui-compiler and committed alongside them.
 */
export const REPEAT_FLEET_DEF = readFixture("apps/api/e2e/support/fixtures/repeat-fleet-form.json");

/** The five question definitions the `repeat-fleet` form pins. */
export const REPEAT_FLEET_QUESTIONS: readonly {
  readonly questionId: string;
  readonly slug: string;
  readonly definition: unknown;
}[] = [
  {
    questionId: "q_rf_fleet_ref",
    slug: "rf-fleet-ref",
    definition: readFixture("apps/api/e2e/support/fixtures/q-rf-fleet-ref.json"),
  },
  {
    questionId: "q_rf_plate",
    slug: "rf-plate",
    definition: readFixture("apps/api/e2e/support/fixtures/q-rf-plate.json"),
  },
  {
    questionId: "q_rf_service_date",
    slug: "rf-service-date",
    definition: readFixture("apps/api/e2e/support/fixtures/q-rf-service-date.json"),
  },
  {
    questionId: "q_rf_notes",
    slug: "rf-notes",
    definition: readFixture("apps/api/e2e/support/fixtures/q-rf-notes.json"),
  },
  {
    questionId: "q_rf_extras",
    slug: "rf-extras",
    definition: readFixture("apps/api/e2e/support/fixtures/q-rf-extras.json"),
  },
];

/** Repo-relative path of the `repeat-fleet` compiled document (regenerable, see below). */
export const REPEAT_FLEET_COMPILED_PATH = "apps/api/e2e/support/fixtures/repeat-fleet.a2ui.json";

/** The committed golden compiled A2UI document for the `repeat-fleet` form. */
export const REPEAT_FLEET_GOLDEN = readFixture(REPEAT_FLEET_COMPILED_PATH) as CompiledForm;

/**
 * The `repeat-table` form (task 077, ADR-43): the same repeating-group shape as
 * `repeat-fleet` with `presentation: "table"` and columns of **exactly the five
 * allowed cell types** (Q12).
 *
 * It is a form of its own rather than a second presentation of `repeat-fleet`, for two
 * reasons. `repeat-fleet` pins a `longText` and a `multiChoice`, which the table
 * presentation refuses at publish, so the two member lists cannot be one list. And the
 * specs want both presentations reachable in one browser run, which means two
 * published forms rather than one form whose presentation a test mutates.
 *
 * Its six questions are its own (`q_rt_*`), so it collides with no other seed and needs
 * no shared-questions flag. The member list is chosen for what it lets a browser
 * assert:
 *
 * - `q_rt_plate` is **required** and carries **help text**, which puts a required
 *   marker in a cell and a hint on a column header (the hint is on the header rather
 *   than in every cell, because it is identical down the column);
 * - `q_rt_odometer` is the **number** column, which is what gives the `<tfoot>` total
 *   something to total and the tabular-figures selector a column to apply to;
 * - `q_rt_service_date` is the **date**, which on the no-JS path renders the native
 *   date fallback (issue #920) inside a table cell;
 * - `q_rt_garaged` and `q_rt_use` are the **boolean** and **singleChoice**, the two
 *   column types that render a radio group inside a cell, which is what makes the
 *   label-clipping selector's "leave an option's own label alone" rule load-bearing.
 *
 * `open` with `min: 1, max: 3`, so Add and Remove exist and the refusal is one press
 * past the second add. Vehicle domain throughout (043's neutral-domain rule, guarded
 * by `scripts/check-fixture-domain.mjs`).
 */
export const REPEAT_TABLE_DEF = readFixture("apps/api/e2e/support/fixtures/repeat-table-form.json");

/** The six question definitions the `repeat-table` form pins. */
export const REPEAT_TABLE_QUESTIONS: readonly {
  readonly questionId: string;
  readonly slug: string;
  readonly definition: unknown;
}[] = [
  {
    questionId: "q_rt_fleet_ref",
    slug: "rt-fleet-ref",
    definition: readFixture("apps/api/e2e/support/fixtures/q-rt-fleet-ref.json"),
  },
  {
    questionId: "q_rt_plate",
    slug: "rt-plate",
    definition: readFixture("apps/api/e2e/support/fixtures/q-rt-plate.json"),
  },
  {
    questionId: "q_rt_odometer",
    slug: "rt-odometer",
    definition: readFixture("apps/api/e2e/support/fixtures/q-rt-odometer.json"),
  },
  {
    questionId: "q_rt_service_date",
    slug: "rt-service-date",
    definition: readFixture("apps/api/e2e/support/fixtures/q-rt-service-date.json"),
  },
  {
    questionId: "q_rt_garaged",
    slug: "rt-garaged",
    definition: readFixture("apps/api/e2e/support/fixtures/q-rt-garaged.json"),
  },
  {
    questionId: "q_rt_use",
    slug: "rt-use",
    definition: readFixture("apps/api/e2e/support/fixtures/q-rt-use.json"),
  },
];

/** Repo-relative path of the `repeat-table` compiled document (regenerable, see below). */
export const REPEAT_TABLE_COMPILED_PATH = "apps/api/e2e/support/fixtures/repeat-table.a2ui.json";

/** The committed compiled A2UI document for the `repeat-table` form. */
export const REPEAT_TABLE_GOLDEN = readFixture(REPEAT_TABLE_COMPILED_PATH) as CompiledForm;

// --- repeat-tour: the per-instance step presentation (task 076) --------------

/**
 * The `repeat-tour` form: **one step, one repeating group, `presentation:
 * "perInstanceStep"`**, `open` with `min: 3, max: 4` (task 076, ADR-28 as amended
 * 2026-09-29, ADR-43).
 *
 * It is the fixture the per-instance-step specs drive, on both paths, and its shape is
 * the exit criterion written as a form. `min: 3` means the first serve mints three
 * instances, so the one step is **three views** with no respondent action and the progress
 * indicator says three; `max: 4` leaves the group growable, so the Add control on the last
 * view has something to do and one more press reaches the refusal.
 *
 * **The step also holds one plain OPTIONAL question, and that is forced rather than
 * chosen.** A step whose every item is a repeating group has nothing visible before its
 * roster is minted, so it is not a visible step, so nothing is rendered on it, so the mint
 * - which is due on the serve of the group's own step - never happens: the form serves "you
 * have answered everything" from the first request. That is a gap in the minting contract
 * rather than anything about this presentation (it bites the stacked presentation the same
 * way). **It was ruled a defect on 2026-10-03 (Q30) and is to be fixed inside wave 4**;
 * until that fix lands, every repeat fixture needs one non-group question on the step
 * exactly as `repeat-fleet` has one.
 *
 * It is **optional**, so the Continue gate on each view is that view's own plate and
 * nothing else, and it is what makes the "every instance complete but the step still
 * current" branch reachable in a browser. A view narrows the step to one instance of the
 * paginating group and to nothing else, so this question is on every page of the walk -
 * which is correct, and which the specs assert rather than work around.
 *
 * `q_pi_plate` is **required**, which is what makes the no-JS walk a walk: the server
 * serves the first view whose instance is incomplete, so each press of the single
 * readiness-labelled button moves one vehicle forward. `q_pi_odometer` is an optional
 * number, so a view carries more than one control and the narrowing is visible as a set
 * rather than as a single field.
 *
 * Vehicle domain throughout (043's neutral-domain rule, guarded by
 * `scripts/check-fixture-domain.mjs`).
 */
export const REPEAT_TOUR_DEF = readFixture("apps/api/e2e/support/fixtures/repeat-tour-form.json");

/** The three question definitions the `repeat-tour` form pins. */
export const REPEAT_TOUR_QUESTIONS: readonly {
  readonly questionId: string;
  readonly slug: string;
  readonly definition: unknown;
}[] = [
  {
    questionId: "q_pi_depot",
    slug: "pi-depot",
    definition: readFixture("apps/api/e2e/support/fixtures/q-pi-depot.json"),
  },
  {
    questionId: "q_pi_plate",
    slug: "pi-plate",
    definition: readFixture("apps/api/e2e/support/fixtures/q-pi-plate.json"),
  },
  {
    questionId: "q_pi_odometer",
    slug: "pi-odometer",
    definition: readFixture("apps/api/e2e/support/fixtures/q-pi-odometer.json"),
  },
];

/** Repo-relative path of the `repeat-tour` compiled document (regenerable, see below). */
export const REPEAT_TOUR_COMPILED_PATH = "apps/api/e2e/support/fixtures/repeat-tour.a2ui.json";

/** The committed golden compiled A2UI document for the `repeat-tour` form. */
export const REPEAT_TOUR_GOLDEN = readFixture(REPEAT_TOUR_COMPILED_PATH) as CompiledForm;

// --- sample-library: the composed stack's seeded form (issue #994) ----------

/**
 * The **sample-library** form: the one form `pnpm dev:seed` publishes into the
 * composed stack (`pnpm dev:up`), pinning EVERY question that seed writes.
 *
 * It is a separate form from either kitchen sink, and the reason is the question
 * SET rather than taste. `apps/api/scripts/seed-fixtures.ts` loads
 * `packages/core/fixtures/questions/valid/` - seven questions, including
 * `q_preexisting_conditions` and `q_medical_history`, which the vehicle kitchen
 * sink does not pin and cannot: that form and its directory are vehicle-domain by
 * task 043's rule, guarded by `scripts/check-fixture-domain.mjs`, so health-domain
 * questions can never be added to it. The vehicle kitchen sink also pins five
 * questions the seed does not write at all, which would mean shipping the e2e
 * support fixtures into the seed image for a form only the composed stack uses.
 *
 * The health-domain `packages/core/fixtures/forms/valid/kitchen-sink.json` does pin
 * exactly these seven, but it is `frm_kitchen_sink` with slug `kitchen-sink` - the
 * same id and slug `pnpm dev:portal` publishes a DIFFERENT form under. Seeding it
 * here would rebuild the exact confusion issue #129 spent a rename removing. It also
 * pins `q_at_fault_accident@2`, a version the seed does not create.
 *
 * So the definition is its own committed file, under `apps/api/scripts/` because the
 * seed script is what reads it and `docker/seed.Dockerfile` is what ships it. Its
 * compiled document is regenerable through this registry like the other two.
 *
 * Health domain, deliberately and consistently with the library it pins: it sits
 * outside the directory `check-fixture-domain.mjs` scans, and nothing seeds it into
 * the portal e2e or `pnpm dev:portal` paths that rule exists to protect.
 *
 * Coverage: four steps over all seven question types, with one rule that reveals a
 * QUESTION (`q_accident_count`, on an at-fault answer) and one that reveals a whole
 * STEP (`stp_detail`, on a pre-existing-condition selection), so both shapes of
 * conditional visibility are answerable in the composed stack's portal.
 */
export const SAMPLE_LIBRARY_DEF = readFixture("apps/api/scripts/fixtures/sample-library-form.json");

/** `q_preexisting_conditions` - multi-choice, required, 1..3 selected (stp_history). */
export const Q_PREEXISTING_CONDITIONS_DEF = readFixture(
  "packages/core/fixtures/questions/valid/multi-choice.json",
);
/** `q_medical_history` - long text, optional (stp_detail, the conditionally shown step). */
export const Q_MEDICAL_HISTORY_DEF = readFixture(
  "packages/core/fixtures/questions/valid/long-text.json",
);

/** Repo-relative path of the `sample-library` compiled document (regenerable, see below). */
export const SAMPLE_LIBRARY_COMPILED_PATH = "apps/api/scripts/fixtures/sample-library.a2ui.json";

/** The committed compiled A2UI document `pnpm dev:seed` stores verbatim (ADR-18). */
export const SAMPLE_LIBRARY_GOLDEN = readFixture(SAMPLE_LIBRARY_COMPILED_PATH) as CompiledForm;

// --- the drift-guard registry (issue #321) ----------------------------------

/**
 * One committed compiled A2UI document, with the definitions it was compiled
 * from - everything `fixture-drift.test.ts` needs to recompile it with the live
 * compiler and fail on divergence.
 *
 * A compiled document seeded verbatim into `form_versions` and then asserted
 * against by browser specs is only worth anything while it is what the compiler
 * still emits. Nothing recompiled these, so a `@roonga/qcms-a2ui-compiler` change
 * desynced them silently: every spec kept passing against a document the
 * compiler no longer produces (issue #321). Adding a compiled fixture means
 * adding a row here.
 */
export interface CompiledFixture {
  /** Human name, used in test titles and in the regeneration report. */
  readonly name: string;
  /** Repo-relative path of the committed compiled document. */
  readonly path: string;
  /**
   * False for a document under `packages/a2ui-compiler/golden/`: that corpus is
   * append-only (ADR-18) and is never rewritten to fit new output. A divergence
   * there is a spec-bump question, not a regeneration.
   */
  readonly regenerable: boolean;
  /** The plain-JSON `FormDefinition` this document was compiled from. */
  readonly form: unknown;
  /** Every plain-JSON `QuestionDefinition` the form pins. */
  readonly questions: readonly unknown[];
}

export const COMPILED_FIXTURES: readonly CompiledFixture[] = [
  {
    name: "insurance",
    path: INSURANCE_GOLDEN_PATH,
    regenerable: false,
    form: INSURANCE_DEF,
    questions: [Q_ACCIDENT_DEF, Q_ACCIDENT_COUNT_DEF],
  },
  {
    name: "vehicle-kitchen-sink",
    path: KITCHEN_SINK_COMPILED_PATH,
    regenerable: true,
    form: KITCHEN_SINK_DEF,
    questions: [
      Q_FULL_NAME_DEF,
      Q_DOB_DEF,
      Q_ACCIDENT_DEF,
      Q_ACCIDENT_COUNT_DEF,
      Q_OPTIONAL_COVER_DEF,
      Q_EXTRA_DETAIL_DEF,
      Q_COVERAGE_DEF,
      Q_ANNUAL_KM_DEF,
      Q_BODY_TYPE_DEF,
      Q_OVERNIGHT_PARKING_DEF,
    ],
  },
  {
    name: "author-messages",
    path: AUTHOR_MESSAGES_COMPILED_PATH,
    regenerable: true,
    form: AUTHOR_MESSAGES_DEF,
    questions: AUTHOR_MESSAGES_QUESTIONS.map((question) => question.definition),
  },
  {
    name: "repeat-fleet",
    path: REPEAT_FLEET_COMPILED_PATH,
    regenerable: true,
    form: REPEAT_FLEET_DEF,
    questions: REPEAT_FLEET_QUESTIONS.map((question) => question.definition),
  },
  {
    name: "repeat-table",
    path: REPEAT_TABLE_COMPILED_PATH,
    regenerable: true,
    form: REPEAT_TABLE_DEF,
    questions: REPEAT_TABLE_QUESTIONS.map((question) => question.definition),
  },
  {
    name: "repeat-tour",
    path: REPEAT_TOUR_COMPILED_PATH,
    regenerable: true,
    form: REPEAT_TOUR_DEF,
    questions: REPEAT_TOUR_QUESTIONS.map((question) => question.definition),
  },
  {
    name: "sample-library",
    path: SAMPLE_LIBRARY_COMPILED_PATH,
    regenerable: true,
    form: SAMPLE_LIBRARY_DEF,
    questions: [
      Q_FULL_NAME_DEF,
      Q_DOB_DEF,
      Q_ACCIDENT_DEF,
      Q_ACCIDENT_COUNT_DEF,
      Q_PREEXISTING_CONDITIONS_DEF,
      Q_MEDICAL_HISTORY_DEF,
      Q_COVERAGE_DEF,
    ],
  },
];
