/**
 * Wider reach than its directory: the portal and admin Playwright suites seed through it,
 * and `scripts/dev-stack.mjs` and `apps/api/scripts/seed-fixtures.ts` mirror its pipeline.
 */

import {
  FormId,
  type LinkClaims,
  LinkId,
  QuestionId,
  importCompactTokenKey,
  mintSecureLink,
} from "@roonga/qcms-core";
import {
  closeFormInEnvironment,
  createForm,
  insertFormRelease,
  createQuestionVersion,
  createQuestion,
  insertFormVersion,
  insertSecureLink,
  publishQuestionVersion,
  upsertDraft,
} from "@roonga/qcms-db";
import { SEED_WORKSPACE_ID, DEFAULT_TEST_ENVIRONMENT, type TestDb } from "@roonga/qcms-db/testing";

import {
  AUTHOR_MESSAGES_DEF,
  AUTHOR_MESSAGES_GOLDEN,
  REPEAT_FLEET_DEF,
  REPEAT_FLEET_GOLDEN,
  REPEAT_FLEET_QUESTIONS,
  REPEAT_TOUR_DEF,
  REPEAT_TOUR_GOLDEN,
  REPEAT_TOUR_QUESTIONS,
  REPEAT_TABLE_DEF,
  REPEAT_TABLE_GOLDEN,
  REPEAT_TABLE_QUESTIONS,
  AUTHOR_MESSAGES_QUESTIONS,
  INSURANCE_DEF,
  INSURANCE_GOLDEN,
  KITCHEN_SINK_DEF,
  KITCHEN_SINK_GOLDEN,
  Q_ACCIDENT_COUNT_DEF,
  Q_ACCIDENT_DEF,
  Q_ANNUAL_KM_DEF,
  Q_BODY_TYPE_DEF,
  Q_COVERAGE_DEF,
  Q_DOB_DEF,
  Q_EXTRA_DETAIL_DEF,
  Q_FULL_NAME_DEF,
  Q_OPTIONAL_COVER_DEF,
  Q_OVERNIGHT_PARKING_DEF,
} from "./fixtures.js";

type Db = TestDb["db"];
type FormVersionInput = Parameters<typeof insertFormVersion>[1];
type QuestionVersionInput = Parameters<typeof createQuestionVersion>[1];

const DEF = INSURANCE_DEF as FormVersionInput["definition"];
const COMPILED = INSURANCE_GOLDEN as unknown as FormVersionInput["compiled"];
const ACCIDENT_DEF = Q_ACCIDENT_DEF as QuestionVersionInput["definition"];
const ACCIDENT_COUNT_DEF = Q_ACCIDENT_COUNT_DEF as QuestionVersionInput["definition"];

/**
 * A form version may only pin a published question version, so a seeded pin that stayed
 * draft is a fixture an admin-side compile rejects with `UNPUBLISHED_QUESTION_PIN`.
 */
async function appendPublishedVersion(
  db: Db,
  questionId: QuestionId,
  definition: QuestionVersionInput["definition"],
): Promise<void> {
  const row = await createQuestionVersion(db, { questionId, definition });
  await publishQuestionVersion(db, { questionId, version: row.version });
}

export async function seedInsuranceQuestions(db: Db): Promise<void> {
  const accident = QuestionId.parse("q_at_fault_accident");
  await createQuestion(db, {
    workspaceId: SEED_WORKSPACE_ID,
    questionId: accident,
    slug: "accident",
  });
  // The form pins q_at_fault_accident@2, so create v1 then v2 (identical definitions).
  await appendPublishedVersion(db, accident, ACCIDENT_DEF);
  await appendPublishedVersion(db, accident, ACCIDENT_DEF);
  const accidentCount = QuestionId.parse("q_accident_count");
  await createQuestion(db, {
    workspaceId: SEED_WORKSPACE_ID,
    questionId: accidentCount,
    slug: "accident-count",
  });
  await appendPublishedVersion(db, accidentCount, ACCIDENT_COUNT_DEF);
}

export interface SeededForm {
  readonly formId: string;
  readonly slug: string;
}

/**
 * `sharedQuestionsSeeded` skips the library questions for a second form that pins the same
 * ones. The closed state is per (form, environment), so `closed` closes the environment
 * the seed released to and `closedEnvironment` names another.
 */
export async function seedInsuranceForm(
  db: Db,
  opts: {
    formId?: string;
    slug?: string;
    sharedQuestionsSeeded?: boolean;
    closed?: boolean;
    closedEnvironment?: string;
  } = {},
): Promise<SeededForm> {
  const formId = opts.formId ?? "frm_auto_quote";
  const slug = opts.slug ?? "auto";
  if (opts.sharedQuestionsSeeded !== true) await seedInsuranceQuestions(db);
  await createForm(db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: FormId.parse(formId),
    slug,
    defaultLocale: "en",
  });
  await publishInsuranceVersion(db, formId);
  if (opts.closed === true) {
    await closeFormInEnvironment(db, {
      formId: FormId.parse(formId),
      environment: opts.closedEnvironment ?? DEFAULT_TEST_ENVIRONMENT,
      closedBy: "usr_e2e_seed",
    });
  }
  return { formId, slug };
}

/**
 * Invalid on purpose, on a form nothing else touches: two library questions of its own
 * ({@link STALE_PIN_QUESTIONS}), each with a single never-published version, both pinned.
 *
 * A draft and no published version, because a published version pinning unpublished
 * questions is a state the real publish path refuses.
 */
export async function seedUnpublishedPinForm(
  db: Db,
  opts: { formId?: string; slug?: string } = {},
): Promise<SeededForm> {
  const formId = opts.formId ?? "frm_unpublished_pins";
  const slug = opts.slug ?? "unpublished-pins";
  const items: { questionId: string; version: number }[] = [];
  for (const question of STALE_PIN_QUESTIONS) {
    const questionId = QuestionId.parse(question.questionId);
    await createQuestion(db, { workspaceId: SEED_WORKSPACE_ID, questionId, slug: question.slug });
    // No publish, and that is the whole fixture: an appended version is a draft.
    const row = await createQuestionVersion(db, {
      questionId,
      definition: questionDefinitionFor(questionId, question.definition),
    });
    items.push({ questionId: question.questionId, version: row.version });
  }
  await createForm(db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: FormId.parse(formId),
    slug,
    defaultLocale: "en",
  });
  await upsertDraft(db, {
    formId: FormId.parse(formId),
    definition: {
      formId,
      defaultLocale: "en",
      title: { en: "Draft with unpublished pins" },
      // As small as a valid draft can be: extra shape is another way for the issue count
      // this fixture is about to move.
      steps: [
        {
          stepId: "stp_history",
          title: { en: "Driving history" },
          items,
        },
      ],
      rules: [],
      // Cast: a plain object literal the kernel's schema validates at the boundary it is
      // handed to, assembled here rather than parsed off disk.
    } as unknown as Parameters<typeof upsertDraft>[1]["definition"],
  });
  return { formId, slug };
}

/**
 * Its own questions rather than another version of the shared ones: appending an
 * unpublished version to `q_at_fault_accident` would make the shared library's latest
 * version a draft, which roughly forty browser specs read.
 */
const STALE_PIN_QUESTIONS = [
  { questionId: "q_stale_accident", slug: "stale-accident", definition: ACCIDENT_DEF },
  {
    questionId: "q_stale_accident_count",
    slug: "stale-accident-count",
    definition: ACCIDENT_COUNT_DEF,
  },
] as const;

/**
 * Stored verbatim, so spell out the optional objects: a definition without `constraints`
 * crashes the kernel's validator.
 */
function questionDefinitionFor(
  questionId: QuestionId,
  definition: QuestionVersionInput["definition"],
): QuestionVersionInput["definition"] {
  const copy = structuredClone(definition) as { questionId: string };
  copy.questionId = questionId;
  return copy as QuestionVersionInput["definition"];
}

/**
 * Publishing a version reaches no environment (ADR-40), so a seed that only published
 * would stand up a form no session can start on.
 */
async function releaseSeededVersion(db: Db, formId: string, version: number): Promise<void> {
  await releaseSeededVersionTo(db, formId, version, DEFAULT_TEST_ENVIRONMENT);
}

/**
 * Exported because the browser harness needs a form served in `test`; it lives here since
 * the portal depends on neither `@roonga/qcms-core` nor `@roonga/qcms-db` (R2).
 */
export async function releaseSeededVersionTo(
  db: Db,
  formId: string,
  version: number,
  environment: string,
): Promise<void> {
  await insertFormRelease(db, {
    formId: FormId.parse(formId),
    environment,
    version,
    releasedBy: "usr_e2e_seed",
  });
}

export async function publishInsuranceVersion(db: Db, formId: string): Promise<void> {
  const version = await insertFormVersion(db, {
    formId: FormId.parse(formId),
    definition: DEF,
    compiled: COMPILED,
    compilerVersion: INSURANCE_GOLDEN.compilerVersion,
    a2uiSpecVersion: INSURANCE_GOLDEN.a2uiSpecVersion,
    semanticsVersion: "1",
  });
  // Released as well as published, which is what makes the new version the one a session
  // started after this resolves (ADR-40).
  await releaseSeededVersion(db, formId, version.version);
}

const KS_DEF = KITCHEN_SINK_DEF as FormVersionInput["definition"];
const KS_COMPILED = KITCHEN_SINK_GOLDEN as unknown as FormVersionInput["compiled"];

async function seedQuestionVersion(
  db: Db,
  questionId: string,
  slug: string,
  definition: QuestionVersionInput["definition"],
): Promise<void> {
  const parsed = QuestionId.parse(questionId);
  await createQuestion(db, { workspaceId: SEED_WORKSPACE_ID, questionId: parsed, slug });
  await appendPublishedVersion(db, parsed, definition);
}

/**
 * The two questions this form shares with the insurance form are split into
 * {@link seedKitchenSinkSharedQuestions}, so a harness that already seeded the insurance
 * form does not re-create them and collide on the `questions` primary key.
 */
export async function seedKitchenSinkUniqueQuestions(db: Db): Promise<void> {
  await seedQuestionVersion(
    db,
    "q_full_name",
    "full-name",
    Q_FULL_NAME_DEF as QuestionVersionInput["definition"],
  );
  await seedQuestionVersion(db, "q_dob", "dob", Q_DOB_DEF as QuestionVersionInput["definition"]);
  await seedQuestionVersion(
    db,
    "q_optional_cover",
    "optional-cover",
    Q_OPTIONAL_COVER_DEF as QuestionVersionInput["definition"],
  );
  await seedQuestionVersion(
    db,
    "q_extra_detail",
    "extra-detail",
    Q_EXTRA_DETAIL_DEF as QuestionVersionInput["definition"],
  );
  await seedQuestionVersion(
    db,
    "q_coverage_level",
    "coverage-level",
    Q_COVERAGE_DEF as QuestionVersionInput["definition"],
  );
  await seedQuestionVersion(
    db,
    "q_annual_km",
    "annual-km",
    Q_ANNUAL_KM_DEF as QuestionVersionInput["definition"],
  );
  await seedQuestionVersion(
    db,
    "q_body_type",
    "body-type",
    Q_BODY_TYPE_DEF as QuestionVersionInput["definition"],
  );
  await seedQuestionVersion(
    db,
    "q_overnight_parking",
    "overnight-parking",
    Q_OVERNIGHT_PARKING_DEF as QuestionVersionInput["definition"],
  );
}

export async function seedKitchenSinkSharedQuestions(db: Db): Promise<void> {
  // q_at_fault_accident is pinned @2, so create v1 then v2 (identical definitions).
  const accident = QuestionId.parse("q_at_fault_accident");
  await createQuestion(db, {
    workspaceId: SEED_WORKSPACE_ID,
    questionId: accident,
    slug: "accident",
  });
  await appendPublishedVersion(db, accident, ACCIDENT_DEF);
  await appendPublishedVersion(db, accident, ACCIDENT_DEF);
  await seedQuestionVersion(db, "q_accident_count", "accident-count", ACCIDENT_COUNT_DEF);
}

/**
 * Pass `sharedQuestionsSeeded: true` when the two insurance-shared questions already
 * exist, so they are not re-created.
 */
export async function seedKitchenSinkForm(
  db: Db,
  opts: { formId?: string; slug?: string; sharedQuestionsSeeded?: boolean } = {},
): Promise<SeededForm> {
  const formId = opts.formId ?? "frm_kitchen_sink";
  const slug = opts.slug ?? "kitchen-sink";
  if (opts.sharedQuestionsSeeded !== true) {
    await seedKitchenSinkSharedQuestions(db);
  }
  await seedKitchenSinkUniqueQuestions(db);
  await createForm(db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: FormId.parse(formId),
    slug,
    defaultLocale: "en",
  });
  const seeded = await insertFormVersion(db, {
    formId: FormId.parse(formId),
    definition: KS_DEF,
    compiled: KS_COMPILED,
    compilerVersion: KITCHEN_SINK_GOLDEN.compilerVersion,
    a2uiSpecVersion: KITCHEN_SINK_GOLDEN.a2uiSpecVersion,
    semanticsVersion: "1",
  });
  await releaseSeededVersion(db, formId, seeded.version);
  return { formId, slug };
}

export async function seedAuthorMessagesForm(
  db: Db,
  opts: { formId?: string; slug?: string } = {},
): Promise<SeededForm> {
  const formId = opts.formId ?? "frm_author_messages";
  const slug = opts.slug ?? "author-messages";
  for (const question of AUTHOR_MESSAGES_QUESTIONS) {
    await seedQuestionVersion(
      db,
      question.questionId,
      question.slug,
      question.definition as QuestionVersionInput["definition"],
    );
  }
  await createForm(db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: FormId.parse(formId),
    slug,
    defaultLocale: "en",
  });
  const seeded = await insertFormVersion(db, {
    formId: FormId.parse(formId),
    definition: AUTHOR_MESSAGES_DEF as FormVersionInput["definition"],
    compiled: AUTHOR_MESSAGES_GOLDEN as unknown as FormVersionInput["compiled"],
    compilerVersion: AUTHOR_MESSAGES_GOLDEN.compilerVersion,
    a2uiSpecVersion: AUTHOR_MESSAGES_GOLDEN.a2uiSpecVersion,
    semanticsVersion: "1",
  });
  await releaseSeededVersion(db, formId, seeded.version);
  return { formId, slug };
}

export async function seedRepeatFleetForm(
  db: Db,
  opts: { formId?: string; slug?: string } = {},
): Promise<SeededForm> {
  const formId = opts.formId ?? "frm_repeat_fleet";
  const slug = opts.slug ?? "repeat-fleet";
  for (const question of REPEAT_FLEET_QUESTIONS) {
    await seedQuestionVersion(
      db,
      question.questionId,
      question.slug,
      question.definition as QuestionVersionInput["definition"],
    );
  }
  await createForm(db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: FormId.parse(formId),
    slug,
    defaultLocale: "en",
  });
  const seeded = await insertFormVersion(db, {
    formId: FormId.parse(formId),
    definition: REPEAT_FLEET_DEF as FormVersionInput["definition"],
    compiled: REPEAT_FLEET_GOLDEN as unknown as FormVersionInput["compiled"],
    compilerVersion: REPEAT_FLEET_GOLDEN.compilerVersion,
    a2uiSpecVersion: REPEAT_FLEET_GOLDEN.a2uiSpecVersion,
    semanticsVersion: "1",
  });
  await releaseSeededVersion(db, formId, seeded.version);
  return { formId, slug };
}

export async function seedRepeatTableForm(
  db: Db,
  opts: { formId?: string; slug?: string } = {},
): Promise<SeededForm> {
  const formId = opts.formId ?? "frm_repeat_table";
  const slug = opts.slug ?? "repeat-table";
  for (const question of REPEAT_TABLE_QUESTIONS) {
    await seedQuestionVersion(
      db,
      question.questionId,
      question.slug,
      question.definition as QuestionVersionInput["definition"],
    );
  }
  await createForm(db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: FormId.parse(formId),
    slug,
    defaultLocale: "en",
  });
  const seeded = await insertFormVersion(db, {
    formId: FormId.parse(formId),
    definition: REPEAT_TABLE_DEF as FormVersionInput["definition"],
    compiled: REPEAT_TABLE_GOLDEN as unknown as FormVersionInput["compiled"],
    compilerVersion: REPEAT_TABLE_GOLDEN.compilerVersion,
    a2uiSpecVersion: REPEAT_TABLE_GOLDEN.a2uiSpecVersion,
    semanticsVersion: "1",
  });
  await releaseSeededVersion(db, formId, seeded.version);
  return { formId, slug };
}

export async function seedRepeatTourForm(
  db: Db,
  opts: { formId?: string; slug?: string } = {},
): Promise<SeededForm> {
  const formId = opts.formId ?? "frm_repeat_tour";
  const slug = opts.slug ?? "repeat-tour";
  for (const question of REPEAT_TOUR_QUESTIONS) {
    await seedQuestionVersion(
      db,
      question.questionId,
      question.slug,
      question.definition as QuestionVersionInput["definition"],
    );
  }
  await createForm(db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: FormId.parse(formId),
    slug,
    defaultLocale: "en",
  });
  const seeded = await insertFormVersion(db, {
    formId: FormId.parse(formId),
    definition: REPEAT_TOUR_DEF as FormVersionInput["definition"],
    compiled: REPEAT_TOUR_GOLDEN as unknown as FormVersionInput["compiled"],
    compilerVersion: REPEAT_TOUR_GOLDEN.compilerVersion,
    a2uiSpecVersion: REPEAT_TOUR_GOLDEN.a2uiSpecVersion,
    semanticsVersion: "1",
  });
  await releaseSeededVersion(db, formId, seeded.version);
  return { formId, slug };
}

/**
 * Mints with the config's link signing key, so the token verifies in any composition built
 * from the same env. It is also how a scenario gets an expired link, which the mint
 * endpoint allows no way to produce.
 */
export async function mintInsuranceLink(
  db: Db,
  config: { keys: { link: readonly string[] } },
  formId: string,
  opts: { linkId: string; expiresAt: Date; oneTime?: boolean; environment?: string },
): Promise<string> {
  const parsedFormId = FormId.parse(formId);
  const linkId = LinkId.parse(opts.linkId);
  const oneTime = opts.oneTime ?? false;
  await insertSecureLink(db, {
    linkId,
    formId: parsedFormId,
    expiresAt: opts.expiresAt,
    // Defaults to the environment the harness's own connection serves, so a fixture that
    // says nothing about environments seeds a link the default pool can redeem (Q46).
    environment: opts.environment ?? DEFAULT_TEST_ENVIRONMENT,
    oneTime,
  });
  const firstKey = config.keys.link[0];
  if (firstKey === undefined) throw new Error("config has no link signing key");
  const linkKey = await importCompactTokenKey(new TextEncoder().encode(firstKey));
  const claims: LinkClaims = {
    formId: parsedFormId,
    linkId,
    expiresAt: opts.expiresAt.toISOString(),
    oneTime,
  };
  return mintSecureLink(claims, linkKey);
}
