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

import { COMPILER_VERSION } from "@qcms/a2ui-compiler";

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
 * The form is VEHICLE-domain throughout (043's neutral-domain rule): the two
 * questions unique to this form (optional-cover multi-choice, extra-detail long
 * text) live in this support directory rather than the shared kernel fixtures,
 * whose bytes are frozen by the golden corpus. The compiled golden is generated
 * from these definitions via the a2ui-compiler and committed alongside them.
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

// --- the drift-guard registry (issue #321) ----------------------------------

/**
 * One committed compiled A2UI document, with the definitions it was compiled
 * from - everything `fixture-drift.test.ts` needs to recompile it with the live
 * compiler and fail on divergence.
 *
 * A compiled document seeded verbatim into `form_versions` and then asserted
 * against by browser specs is only worth anything while it is what the compiler
 * still emits. Nothing recompiled these, so a `@qcms/a2ui-compiler` change
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
    ],
  },
  {
    name: "author-messages",
    path: AUTHOR_MESSAGES_COMPILED_PATH,
    regenerable: true,
    form: AUTHOR_MESSAGES_DEF,
    questions: AUTHOR_MESSAGES_QUESTIONS.map((question) => question.definition),
  },
];
