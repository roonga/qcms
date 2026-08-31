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
 *
 * **This file's reach is wider than its directory, so changes here need
 * `verify:browser` as well as `verify`.** The portal AND admin Playwright suites
 * seed through it: `apps/portal/e2e/support/api-server.ts` calls these helpers in
 * the browser harness's global setup, and every admin spec reads the forms they
 * leave behind. `scripts/dev-stack.mjs` does not import this file but mirrors its
 * publish pipeline verbatim for `pnpm dev:seed`, so a change to what "seeded"
 * means belongs in both. Issue #275 is the worked example: a one-line correction
 * here was green under `verify` and red in the admin browser suite.
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
  closeForm,
  createForm,
  createQuestionVersion,
  createQuestion,
  insertFormVersion,
  insertSecureLink,
  publishQuestionVersion,
  upsertDraft,
} from "@qcms/db";
import type { TestDb } from "@qcms/db/testing";

import {
  AUTHOR_MESSAGES_DEF,
  AUTHOR_MESSAGES_GOLDEN,
  AUTHOR_MESSAGES_QUESTIONS,
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

/**
 * Append one question version and publish it. A form version may only pin a
 * *published* question version, so a seeded pin that stayed draft is a fixture
 * an admin-side compile rejects with `UNPUBLISHED_QUESTION_PIN` (issue #275).
 * The version number comes back from the insert, so this is correct for the
 * first version and for every version appended after it.
 */
async function appendPublishedVersion(
  db: Db,
  questionId: QuestionId,
  definition: QuestionVersionInput["definition"],
): Promise<void> {
  const row = await createQuestionVersion(db, { questionId, definition });
  await publishQuestionVersion(db, { questionId, version: row.version });
}

/** The library questions the insurance form pins: q_at_fault_accident@2, q_accident_count@1. */
export async function seedInsuranceQuestions(db: Db): Promise<void> {
  const accident = QuestionId.parse("q_at_fault_accident");
  await createQuestion(db, { questionId: accident, slug: "accident" });
  // The form pins q_at_fault_accident@2, so create v1 then v2 (identical definitions).
  await appendPublishedVersion(db, accident, ACCIDENT_DEF);
  await appendPublishedVersion(db, accident, ACCIDENT_DEF);
  const accidentCount = QuestionId.parse("q_accident_count");
  await createQuestion(db, { questionId: accidentCount, slug: "accident-count" });
  await appendPublishedVersion(db, accidentCount, ACCIDENT_COUNT_DEF);
}

/** A seeded insurance form's identifiers (plain strings for consumer ergonomics). */
export interface SeededForm {
  readonly formId: string;
  readonly slug: string;
}

/**
 * Seed the insurance questions plus a form with one published version storing the
 * golden compiled A2UI. Returns the form id and slug the respondent path uses.
 *
 * `sharedQuestionsSeeded` skips the library questions for a second form that
 * pins the same ones (the kitchen-sink seed takes the same option).
 * `closed` publishes the version and then closes the form, which is the state a
 * respondent meets when a link outlives the questionnaire (ADR-39).
 */
export async function seedInsuranceForm(
  db: Db,
  opts: {
    formId?: string;
    slug?: string;
    sharedQuestionsSeeded?: boolean;
    closed?: boolean;
  } = {},
): Promise<SeededForm> {
  const formId = opts.formId ?? "frm_auto_quote";
  const slug = opts.slug ?? "auto";
  if (opts.sharedQuestionsSeeded !== true) await seedInsuranceQuestions(db);
  await createForm(db, { formId: FormId.parse(formId), slug, defaultLocale: "en" });
  await publishInsuranceVersion(db, formId);
  if (opts.closed === true) await closeForm(db, FormId.parse(formId));
  return { formId, slug };
}

/**
 * Seed a form whose draft pins question versions that were never published, so an
 * admin dry run reports exactly two `UNPUBLISHED_QUESTION_PIN` issues against
 * `stp_history` (issue #625's fixture, made deliberate by issue #275).
 *
 * **Why this exists as its own form.** `apps/admin/e2e/validation-idle.pw.ts`
 * needs a draft with a known, non-zero issue count, and until now it borrowed one:
 * the insurance seed forgot to publish its question versions, so *every* form in
 * the harness carried two issues by accident, and the spec read `frm_auto_quote`.
 * Correcting the seed removed the fixture the spec depended on. Both intents stand
 * here instead: the shared fixture is valid, and the invalid one is invalid on
 * purpose, on a form nothing else touches.
 *
 * **How it is invalid.** It brings two library questions of its own
 * ({@link STALE_PIN_QUESTIONS}), each with a single version that is never
 * published, and pins both. The version number comes back from the insert rather
 * than being written down. Nothing shared moves: the insurance and kitchen-sink
 * fixtures keep exactly the library they had.
 *
 * **A draft and no published version, deliberately.** The state the old accident
 * produced - a *published* form version pinning unpublished questions - is one the
 * real publish path refuses, which is precisely why it was a trap for anyone
 * reading the seed to decide what it could be used for. An unpublished draft is
 * the legitimate way for a form to hold pins that would fail a publish, and it is
 * the state the builder and the rail badge are about.
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
    await createQuestion(db, { questionId, slug: question.slug });
    // No publish, and that is the whole fixture: an appended version is a draft.
    const row = await createQuestionVersion(db, {
      questionId,
      definition: questionDefinitionFor(questionId, question.definition),
    });
    items.push({ questionId: question.questionId, version: row.version });
  }
  await createForm(db, { formId: FormId.parse(formId), slug, defaultLocale: "en" });
  await upsertDraft(db, {
    formId: FormId.parse(formId),
    definition: {
      formId,
      defaultLocale: "en",
      title: { en: "Draft with unpublished pins" },
      // One step, both pins on it, no rules. The step id and title are the two the
      // 625 spec addresses; everything else is as small as a valid draft can be,
      // because what this fixture is for is the ISSUE COUNT and any extra shape
      // would be another way for that count to move.
      steps: [
        {
          stepId: "stp_history",
          title: { en: "Driving history" },
          items,
        },
      ],
      rules: [],
      // The definition is assembled here rather than parsed off disk, so this is
      // the same cast the fixture constants above take for the same reason: these
      // helpers are typed against the kernel's schema and this is a plain object
      // literal the schema validates at the boundary it is handed to.
    } as unknown as Parameters<typeof upsertDraft>[1]["definition"],
  });
  return { formId, slug };
}

/**
 * The two library questions that exist only for the fixture above.
 *
 * **Its own questions rather than another version of the shared ones.** Appending
 * an unpublished version to `q_at_fault_accident` would make that question's
 * LATEST version a draft, which is a visible change to the shared library: the
 * question list renders a latest-version status and the pin picker offers the
 * versions it finds. Roughly forty browser specs read that library. A fixture for
 * one spec has no business moving it, so these are two questions nothing else
 * pins, carrying the same vehicle-domain definitions (task 043) under their own
 * ids.
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
 * A question definition under another question id. A definition carries the id it
 * belongs to, so a clone is the only way to reuse one; structural, so the shared
 * fixture constants the other seeds hand to `createQuestionVersion` are untouched.
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
  const parsed = QuestionId.parse(questionId);
  await createQuestion(db, { questionId: parsed, slug });
  await appendPublishedVersion(db, parsed, definition);
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
  const accident = QuestionId.parse("q_at_fault_accident");
  await createQuestion(db, { questionId: accident, slug: "accident" });
  await appendPublishedVersion(db, accident, ACCIDENT_DEF);
  await appendPublishedVersion(db, accident, ACCIDENT_DEF);
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
 * Seed the `author-messages` form (task 048): four required questions carrying
 * author-supplied validation messages (ADR-32) and boolean label overrides
 * (ADR-36), plus a published version storing its committed golden compiled A2UI
 * (ADR-18). Its questions are unique to it, so it never collides with the
 * insurance or kitchen-sink seeds and needs no shared-questions flag.
 */
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
  await createForm(db, { formId: FormId.parse(formId), slug, defaultLocale: "en" });
  await insertFormVersion(db, {
    formId: FormId.parse(formId),
    definition: AUTHOR_MESSAGES_DEF as FormVersionInput["definition"],
    compiled: AUTHOR_MESSAGES_GOLDEN as unknown as FormVersionInput["compiled"],
    compilerVersion: AUTHOR_MESSAGES_GOLDEN.compilerVersion,
    a2uiSpecVersion: AUTHOR_MESSAGES_GOLDEN.a2uiSpecVersion,
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
