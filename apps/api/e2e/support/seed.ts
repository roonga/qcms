/**
 * The insurance seed toolkit (task 027) - shared with the portal e2e tests (029).
 *
 * These helpers stand up the canonical `insurance` form directly through the
 * `@qcms/db` helpers (the fast, deterministic path), so scenarios that are about
 * the *respondent* loop, version pinning, mount-split topology, or failure modes
 * don't re-drive the whole authoring API each time. Scenario 1 is the exception:
 * it authors the same form over HTTP to prove the admin surface end to end.
 *
 * Seeding is not a slice-internal reach: it uses only the published `@qcms/db`
 * and `@qcms/core` APIs. The compiled A2UI stored here is the committed golden
 * document (ADR-18) - the serve path replays those exact bytes, never recompiles.
 */

import {
  FormId,
  type LinkClaims,
  LinkId,
  QuestionId,
  importCompactTokenKey,
  mintSecureLink,
} from "@qcms/core";
import {
  createForm,
  createQuestionVersion,
  createQuestion,
  insertFormVersion,
  insertSecureLink,
} from "@qcms/db";
import type { TestDb } from "@qcms/db/testing";

import {
  INSURANCE_DEF,
  INSURANCE_GOLDEN,
  KITCHEN_SINK_DEF,
  KITCHEN_SINK_GOLDEN,
  Q_ACCIDENT_COUNT_DEF,
  Q_ACCIDENT_DEF,
  Q_COVERAGE_DEF,
  Q_DOB_DEF,
  Q_EXTRA_DETAIL_DEF,
  Q_FULL_NAME_DEF,
  Q_OPTIONAL_COVER_DEF,
} from "./fixtures.js";

type Db = TestDb["db"];
type FormVersionInput = Parameters<typeof insertFormVersion>[1];
type QuestionVersionInput = Parameters<typeof createQuestionVersion>[1];

const DEF = INSURANCE_DEF as FormVersionInput["definition"];
const COMPILED = INSURANCE_GOLDEN as unknown as FormVersionInput["compiled"];
const ACCIDENT_DEF = Q_ACCIDENT_DEF as QuestionVersionInput["definition"];
const ACCIDENT_COUNT_DEF = Q_ACCIDENT_COUNT_DEF as QuestionVersionInput["definition"];

/** The library questions the insurance form pins: q_at_fault_accident@2, q_accident_count@1. */
export async function seedInsuranceQuestions(db: Db): Promise<void> {
  await createQuestion(db, {
    questionId: QuestionId.parse("q_at_fault_accident"),
    slug: "accident",
  });
  // The form pins q_at_fault_accident@2, so create v1 then v2 (identical definitions).
  await createQuestionVersion(db, {
    questionId: QuestionId.parse("q_at_fault_accident"),
    definition: ACCIDENT_DEF,
  });
  await createQuestionVersion(db, {
    questionId: QuestionId.parse("q_at_fault_accident"),
    definition: ACCIDENT_DEF,
  });
  await createQuestion(db, {
    questionId: QuestionId.parse("q_accident_count"),
    slug: "accident-count",
  });
  await createQuestionVersion(db, {
    questionId: QuestionId.parse("q_accident_count"),
    definition: ACCIDENT_COUNT_DEF,
  });
}

/** A seeded insurance form's identifiers (plain strings for consumer ergonomics). */
export interface SeededForm {
  readonly formId: string;
  readonly slug: string;
}

/**
 * Seed the insurance questions plus a form with one published version storing the
 * golden compiled A2UI. Returns the form id and slug the respondent path uses.
 */
export async function seedInsuranceForm(
  db: Db,
  opts: { formId?: string; slug?: string } = {},
): Promise<SeededForm> {
  const formId = opts.formId ?? "frm_auto_quote";
  const slug = opts.slug ?? "auto";
  await seedInsuranceQuestions(db);
  await createForm(db, { formId: FormId.parse(formId), slug, defaultLocale: "en" });
  await publishInsuranceVersion(db, formId);
  return { formId, slug };
}

/**
 * Append another published version of the insurance form (identical bytes). Used
 * by the version-pinning scenario to publish "v2" after a session pinned v1.
 */
export async function publishInsuranceVersion(db: Db, formId: string): Promise<void> {
  await insertFormVersion(db, {
    formId: FormId.parse(formId),
    definition: DEF,
    compiled: COMPILED,
    compilerVersion: INSURANCE_GOLDEN.compilerVersion,
    a2uiSpecVersion: INSURANCE_GOLDEN.a2uiSpecVersion,
    semanticsVersion: "1",
  });
}

// --- kitchen-sink form (all seven question types, task 045) -----------------

const KS_DEF = KITCHEN_SINK_DEF as FormVersionInput["definition"];
const KS_COMPILED = KITCHEN_SINK_GOLDEN as unknown as FormVersionInput["compiled"];

/** Create one library question with a single published version. */
async function seedQuestionVersion(
  db: Db,
  questionId: string,
  slug: string,
  definition: QuestionVersionInput["definition"],
): Promise<void> {
  await createQuestion(db, { questionId: QuestionId.parse(questionId), slug });
  await createQuestionVersion(db, { questionId: QuestionId.parse(questionId), definition });
}

/**
 * Seed the questions the kitchen-sink form pins that are UNIQUE to it (the five
 * new types); the two it shares with the insurance form (`q_at_fault_accident`@2,
 * `q_accident_count`) are seeded by {@link seedKitchenSinkSharedQuestions}, split
 * out so a harness that already seeded the insurance form does not re-create them
 * (a duplicate `questions` primary key).
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
}

/** The two questions the kitchen-sink form shares with the insurance form. */
export async function seedKitchenSinkSharedQuestions(db: Db): Promise<void> {
  // q_at_fault_accident is pinned @2: create v1 then v2 (identical definitions).
  await createQuestion(db, {
    questionId: QuestionId.parse("q_at_fault_accident"),
    slug: "accident",
  });
  await createQuestionVersion(db, {
    questionId: QuestionId.parse("q_at_fault_accident"),
    definition: ACCIDENT_DEF,
  });
  await createQuestionVersion(db, {
    questionId: QuestionId.parse("q_at_fault_accident"),
    definition: ACCIDENT_DEF,
  });
  await seedQuestionVersion(db, "q_accident_count", "accident-count", ACCIDENT_COUNT_DEF);
}

/**
 * Seed the kitchen-sink questions plus a form with one published version storing
 * the golden compiled A2UI (ADR-18). Returns the form id and slug. Pass
 * `sharedQuestionsSeeded: true` when the two insurance-shared questions already
 * exist (e.g. the insurance form was seeded first in the same database), so they
 * are not re-created.
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
  await createForm(db, { formId: FormId.parse(formId), slug, defaultLocale: "en" });
  await insertFormVersion(db, {
    formId: FormId.parse(formId),
    definition: KS_DEF,
    compiled: KS_COMPILED,
    compilerVersion: KITCHEN_SINK_GOLDEN.compilerVersion,
    a2uiSpecVersion: KITCHEN_SINK_GOLDEN.a2uiSpecVersion,
    semanticsVersion: "1",
  });
  return { formId, slug };
}

/**
 * Insert a secure_links row and mint its matching signed token. Uses only the
 * published `@qcms/core` minting API and the config's link signing key, so the
 * token verifies in any composition built from the same env. Handy for the
 * failure tour's *expired* link, which the mint endpoint (future-expiry only)
 * cannot produce.
 */
export async function mintInsuranceLink(
  db: Db,
  config: { keys: { link: readonly string[] } },
  formId: string,
  opts: { linkId: string; expiresAt: Date; oneTime?: boolean },
): Promise<string> {
  const parsedFormId = FormId.parse(formId);
  const linkId = LinkId.parse(opts.linkId);
  const oneTime = opts.oneTime ?? false;
  await insertSecureLink(db, { linkId, formId: parsedFormId, expiresAt: opts.expiresAt, oneTime });
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
