import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { COMPILER_VERSION } from "@roonga/qcms-a2ui-compiler";

const REPO_ROOT = new URL("../../../../", import.meta.url);

function readFixture(relative: string): unknown {
  return JSON.parse(readFileSync(new URL(relative, REPO_ROOT), "utf8"));
}

export const INSURANCE_DEF = readFixture("packages/core/fixtures/forms/valid/insurance.json");

export const Q_ACCIDENT_DEF = readFixture("packages/core/fixtures/questions/valid/boolean.json");

export const Q_ACCIDENT_COUNT_DEF = readFixture(
  "packages/core/fixtures/questions/valid/number.json",
);

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
 * The corpus is append-only (ADR-18), so the generation derives from `COMPILER_VERSION`
 * and a version bump without its generation throws here.
 */
function currentGoldenGeneration(): string {
  const generations = readdirSync(fileURLToPath(GOLDEN_ROOT), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number(right.slice(1)) - Number(left.slice(1)));
  for (const generation of generations) {
    const candidate = new URL(`${generation}/insurance.a2ui.json`, GOLDEN_ROOT);
    if (!existsSync(fileURLToPath(candidate))) continue;
    // Cast: a committed corpus document, already asserted spec-valid by the compiler's
    // own golden tests; only its version stamp is read here.
    const document = JSON.parse(readFileSync(candidate, "utf8")) as CompiledForm;
    if (document.compilerVersion === COMPILER_VERSION) return generation;
  }
  throw new Error(
    `no generation under packages/a2ui-compiler/golden/ has an insurance.a2ui.json stamped ` +
      `compilerVersion ${COMPILER_VERSION}. A compiler version bump seeds its own generation ` +
      `directory first (packages/a2ui-compiler/golden/README.md, spec-bump procedure).`,
  );
}

export const INSURANCE_GOLDEN_PATH = `packages/a2ui-compiler/golden/${currentGoldenGeneration()}/insurance.a2ui.json`;

export const INSURANCE_GOLDEN = readFixture(INSURANCE_GOLDEN_PATH) as CompiledForm;

/**
 * The `vehicle-` prefix is load-bearing: a health-domain `kitchen-sink` form with the same
 * coverage and different question ids lives in `packages/core/fixtures/forms/valid/`, and
 * element lookups written against one and run against the other find nothing rather than
 * erroring. See `apps/api/e2e/support/fixtures/README.md`.
 */
export const KITCHEN_SINK_DEF = readFixture(
  "apps/api/e2e/support/fixtures/vehicle-kitchen-sink-form.json",
);

export const Q_FULL_NAME_DEF = readFixture(
  "packages/core/fixtures/questions/valid/short-text.json",
);
export const Q_DOB_DEF = readFixture("packages/core/fixtures/questions/valid/date.json");
export const Q_OPTIONAL_COVER_DEF = readFixture(
  "apps/api/e2e/support/fixtures/q-optional-cover.json",
);
export const Q_EXTRA_DETAIL_DEF = readFixture("apps/api/e2e/support/fixtures/q-extra-detail.json");
export const Q_COVERAGE_DEF = readFixture(
  "packages/core/fixtures/questions/valid/single-choice.json",
);
/**
 * Optional, because a required number cannot be cleared through the browser at all; and
 * integer, because a question admitting fractions would put an `inputMode`
 * mismatch on a seeded page. Appended to `stp_cover` after `q_coverage_level`, so the
 * RadioGroup keeps the tree position `a11y-keyboard.pw.ts` relies on.
 */
export const Q_ANNUAL_KM_DEF = readFixture("apps/api/e2e/support/fixtures/q-annual-km.json");

/**
 * Nine options, clearing `SINGLE_CHOICE_SELECT_THRESHOLD`, so some fixture compiles a
 * `Select` at all; required, because the no-JS defect's worst shape is the required one.
 * Appended after `q_annual_km` for the tree position `a11y-keyboard.pw.ts` relies on.
 */
export const Q_BODY_TYPE_DEF = readFixture("apps/api/e2e/support/fixtures/q-body-type.json");

/**
 * The optional `Select`, because a required one cannot be emptied through the browser:
 * only the no-JS rendering's empty-valued placeholder option can be returned to.
 */
export const Q_OVERNIGHT_PARKING_DEF = readFixture(
  "apps/api/e2e/support/fixtures/q-overnight-parking.json",
);

export const KITCHEN_SINK_COMPILED_PATH =
  "apps/api/e2e/support/fixtures/vehicle-kitchen-sink.a2ui.json";

export const KITCHEN_SINK_GOLDEN = readFixture(KITCHEN_SINK_COMPILED_PATH) as CompiledForm;

/**
 * A separate form rather than messages retrofitted onto the kitchen sink, whose compiled
 * golden's bytes staying still is part of what proves both features additive.
 *
 * `q_am_vin` carries `minLength` rather than `maxLength`, because the compiler forwards
 * `maxLength` as the input's own attribute, so a browser can never provoke it.
 */
export const AUTHOR_MESSAGES_DEF = readFixture(
  "apps/api/e2e/support/fixtures/author-messages-form.json",
);

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

export const AUTHOR_MESSAGES_COMPILED_PATH =
  "apps/api/e2e/support/fixtures/author-messages.a2ui.json";

export const AUTHOR_MESSAGES_GOLDEN = readFixture(AUTHOR_MESSAGES_COMPILED_PATH) as CompiledForm;

/**
 * `q_rf_plate` is required, which is what makes the Add button's `formnovalidate`
 * load-bearing: a respondent who has not filled vehicle 1 must still be able to add
 * vehicle 2.
 */
export const REPEAT_FLEET_DEF = readFixture("apps/api/e2e/support/fixtures/repeat-fleet-form.json");

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

export const REPEAT_FLEET_COMPILED_PATH = "apps/api/e2e/support/fixtures/repeat-fleet.a2ui.json";

export const REPEAT_FLEET_GOLDEN = readFixture(REPEAT_FLEET_COMPILED_PATH) as CompiledForm;

/**
 * A form of its own rather than a second presentation of `repeat-fleet`, whose `longText`
 * and `multiChoice` members a table-presented group is refused at publish for carrying.
 */
export const REPEAT_TABLE_DEF = readFixture("apps/api/e2e/support/fixtures/repeat-table-form.json");

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

export const REPEAT_TABLE_COMPILED_PATH = "apps/api/e2e/support/fixtures/repeat-table.a2ui.json";

export const REPEAT_TABLE_GOLDEN = readFixture(REPEAT_TABLE_COMPILED_PATH) as CompiledForm;

/**
 * `min: 3` means the first serve mints three instances, so the one step is three views
 * with no respondent action; `max: 4` leaves one press between the Add control and the
 * refusal. `q_pi_plate` is required, which is what makes the no-JS walk a walk.
 */
export const REPEAT_TOUR_DEF = readFixture("apps/api/e2e/support/fixtures/repeat-tour-form.json");

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

export const REPEAT_TOUR_COMPILED_PATH = "apps/api/e2e/support/fixtures/repeat-tour.a2ui.json";

export const REPEAT_TOUR_GOLDEN = readFixture(REPEAT_TOUR_COMPILED_PATH) as CompiledForm;

/**
 * The one form `pnpm dev:seed` publishes, pinning every question that seed writes. Not
 * `kitchen-sink.json`, whose id and slug `pnpm dev:portal` publishes a different form under.
 * Health domain, so it sits outside the directory `check-fixture-domain.mjs` scans.
 */
export const SAMPLE_LIBRARY_DEF = readFixture("apps/api/scripts/fixtures/sample-library-form.json");

export const Q_PREEXISTING_CONDITIONS_DEF = readFixture(
  "packages/core/fixtures/questions/valid/multi-choice.json",
);
export const Q_MEDICAL_HISTORY_DEF = readFixture(
  "packages/core/fixtures/questions/valid/long-text.json",
);

export const SAMPLE_LIBRARY_COMPILED_PATH = "apps/api/scripts/fixtures/sample-library.a2ui.json";

export const SAMPLE_LIBRARY_GOLDEN = readFixture(SAMPLE_LIBRARY_COMPILED_PATH) as CompiledForm;

/** Adding a compiled fixture means adding a row here, or nothing ever recompiles it. */
export interface CompiledFixture {
  readonly name: string;
  readonly path: string;
  /**
   * False for a document under `packages/a2ui-compiler/golden/`: that corpus is
   * append-only (ADR-18) and is never rewritten to fit new output.
   */
  readonly regenerable: boolean;
  readonly form: unknown;
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
