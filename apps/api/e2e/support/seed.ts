/**
 * The insurance seed toolkit (task 027) — shared with the portal e2e tests (029).
 *
 * These helpers stand up the canonical `insurance` form directly through the
 * `@qcms/db` helpers (the fast, deterministic path), so scenarios that are about
 * the *respondent* loop, version pinning, mount-split topology, or failure modes
 * don't re-drive the whole authoring API each time. Scenario 1 is the exception:
 * it authors the same form over HTTP to prove the admin surface end to end.
 *
 * Seeding is not a slice-internal reach: it uses only the published `@qcms/db`
 * and `@qcms/core` APIs. The compiled A2UI stored here is the committed golden
 * document (ADR-18) — the serve path replays those exact bytes, never recompiles.
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

import { INSURANCE_DEF, INSURANCE_GOLDEN, Q_CIGS_DEF, Q_SMOKER_DEF } from "./fixtures.js";

type Db = TestDb["db"];
type FormVersionInput = Parameters<typeof insertFormVersion>[1];
type QuestionVersionInput = Parameters<typeof createQuestionVersion>[1];

const DEF = INSURANCE_DEF as FormVersionInput["definition"];
const COMPILED = INSURANCE_GOLDEN as unknown as FormVersionInput["compiled"];
const SMOKER_DEF = Q_SMOKER_DEF as QuestionVersionInput["definition"];
const CIGS_DEF = Q_CIGS_DEF as QuestionVersionInput["definition"];

/** The library questions the insurance form pins: q_smoker@2, q_cigs_daily@1. */
export async function seedInsuranceQuestions(db: Db): Promise<void> {
  await createQuestion(db, { questionId: QuestionId.parse("q_smoker"), slug: "smoker" });
  // The form pins q_smoker@2, so create v1 then v2 (identical definitions).
  await createQuestionVersion(db, {
    questionId: QuestionId.parse("q_smoker"),
    definition: SMOKER_DEF,
  });
  await createQuestionVersion(db, {
    questionId: QuestionId.parse("q_smoker"),
    definition: SMOKER_DEF,
  });
  await createQuestion(db, { questionId: QuestionId.parse("q_cigs_daily"), slug: "cigs" });
  await createQuestionVersion(db, {
    questionId: QuestionId.parse("q_cigs_daily"),
    definition: CIGS_DEF,
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
  const formId = opts.formId ?? "frm_life_signup";
  const slug = opts.slug ?? "life";
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
