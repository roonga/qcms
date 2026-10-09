/**
 * **A step whose every item is a repeating group is reachable** (Q30, Code Owner
 * 2026-10-03). These cases are the fix, and each one fails against the code this work
 * branched from; before the ruling they pinned the defect instead.
 *
 * ## What the defect was
 *
 * `visibleSteps` is derived from `visible`, so a step whose only content was a repeating
 * group with an **empty roster** had nothing visible and was not a visible step. The
 * roster was empty because the mint is due "the first time the group's own step is
 * served" (`mintDueAndLoadRosters`), and the step was never served because it was not
 * visible. The two facts held each other up: a fixpoint of emptiness that nothing a
 * respondent did could break.
 *
 * What a respondent met is the first case below: a form whose single step is a repeating
 * group answered its very first request with `step: null` and `readyToSubmit: true` -
 * "you have answered everything", before they had answered anything, with no control
 * that could change it. It was not a property of any one presentation; the second and
 * third cases are what keep that honest, driving the **stacked** presentation and a
 * group's step sitting behind a plain step.
 *
 * ## The fix, in two halves
 *
 * A step-visible step that holds a repeating group is listed in `visibleSteps`, because
 * the group's own chrome - its heading and its Add control - is content a respondent can
 * act on. And `currentStep` moves with it: it is nominated from `visible`, so without the
 * second half every cursor-less serve still skipped the step and the mint still never
 * happened. A step a STEP RULE hides stays hidden, which `packages/core` asserts.
 *
 * The golden scenario that pinned the old reading was amended in place under the issue
 * #128 defect-correction precedent, hash-pinned in `scripts/check-golden-append-only.mjs`
 * and recorded as the second exception in
 * `packages/core/golden/evaluator/CORPUS.md`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileForm } from "@roonga/qcms-a2ui-compiler";
import {
  compileDraft,
  FormId,
  parseFormDefinition,
  parseQuestionDefinition,
  SessionId,
  type FormDefinition,
  type QuestionDefinition,
} from "@roonga/qcms-core";
import {
  createForm,
  createQuestion,
  createQuestionVersion,
  createSession,
  insertFormVersion,
  rosterLedger,
} from "@roonga/qcms-db";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  DEFAULT_TEST_ENVIRONMENT,
  startTestDb,
  type TestDb,
} from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { fixedClock, internalTokenFor, makeDeps, validEnv } from "../../test-support.js";
import { importSessionKeys, mintSessionToken } from "./session-token.js";
import { registerServeStep } from "./serve-step/route.js";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const PUBLIC_ONLY = { public: true, internal: false, admin: false } as const;
const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

function corpusQuestion(file: string): QuestionDefinition {
  const raw: unknown = JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, "packages", "a2ui-compiler", "fixtures", "corpus", "questions", file),
      "utf8",
    ),
  );
  const parsed = parseQuestionDefinition(raw);
  if (!parsed.ok) throw new Error(`fixture ${file} did not parse`);
  return parsed.value;
}

const PLATE = corpusQuestion("q-rep-plate.json");
const FLEET = corpusQuestion("q-rep-fleet-name.json");
const QUESTIONS = [PLATE, FLEET];

/** One step, holding ONE STACKED GROUP and nothing else. */
/**
 * The group's step FIRST, then a step holding a required plain question (Q30's serve
 * consequence, Code Owner 2026-10-10).
 *
 * This is the shape that loses the cursor-less first serve to semantic 5's first tier: an
 * unminted group contributes no visible question, so `currentStep` nominates the later
 * step with the missing required answer, and a fresh session would open on "Step 2 of 2".
 * It is the passengers-then-contact-details shape of the plan's section 1.1.
 */
function defineGroupFirst(formId: string): FormDefinition {
  const parsed = parseFormDefinition({
    formId,
    defaultLocale: "en",
    title: { en: "Group first" },
    steps: [
      {
        stepId: "stp_only",
        title: { en: "Vehicles" },
        items: [
          {
            groupId: "grp_only",
            label: { en: "Vehicles" },
            instanceLabel: { en: "Vehicle {n}" },
            presentation: "stacked",
            count: { source: "open", min: 2, max: 4 },
            items: [{ questionId: PLATE.questionId, version: 1 }],
          },
        ],
      },
      {
        stepId: "stp_after",
        title: { en: "Contact" },
        items: [{ questionId: FLEET.questionId, version: 1 }],
      },
    ],
    rules: [],
  });
  if (!parsed.ok) throw new Error(`did not parse: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

function define(formId: string, presentation: string, lead: boolean): FormDefinition {
  const group = {
    groupId: "grp_only",
    label: { en: "Vehicles" },
    instanceLabel: { en: "Vehicle {n}" },
    presentation,
    count: { source: "open", min: 2, max: 4 },
    items: [{ questionId: PLATE.questionId, version: 1 }],
  };
  const parsed = parseFormDefinition({
    formId,
    defaultLocale: "en",
    title: { en: "Group only" },
    steps: lead
      ? [
          {
            stepId: "stp_lead",
            title: { en: "Lead" },
            items: [{ questionId: FLEET.questionId, version: 1 }],
          },
          { stepId: "stp_only", title: { en: "Vehicles" }, items: [group] },
        ]
      : [{ stepId: "stp_only", title: { en: "Vehicles" }, items: [group] }],
    rules: [],
  });
  if (!parsed.ok) throw new Error(`did not parse: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let seeded = 0;

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, clock: fixedClock(NOW), env: validEnv() });
  app = createApp(deps, PUBLIC_ONLY, { groups: { public: [registerServeStep] } });
  internalToken = internalTokenFor(deps.config);
  for (const question of QUESTIONS) {
    await createQuestion(testDb.db, {
      questionId: question.questionId,
      slug: question.questionId.replaceAll("_", "-"),
    });
    await createQuestionVersion(testDb.db, {
      questionId: question.questionId,
      definition: question,
    });
  }
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

async function publish(definition: FormDefinition, slug: string): Promise<FormId> {
  const draft = compileDraft({
    definition,
    resolveQuestion: (questionId, version) =>
      version === 1
        ? QUESTIONS.filter((q) => q.questionId === questionId).map((d) => ({
            questionId,
            version,
            definition: d,
          }))[0]
        : undefined,
    publishedQuestionVersions: new Map(QUESTIONS.map((q) => [q.questionId, new Set([1])])),
  });
  if (!draft.ok) throw new Error(`did not publish: ${JSON.stringify(draft.error)}`);
  const compiled = compileForm(draft.value.snapshot, {});
  const formId = FormId.parse(definition.formId);
  await createForm(testDb.db, { formId, slug, defaultLocale: "en" });
  await insertFormVersion(testDb.db, {
    formId,
    definition,
    compiled,
    compilerVersion: compiled.compilerVersion,
    a2uiSpecVersion: compiled.a2uiSpecVersion,
    semanticsVersion: "1",
  });
  return formId;
}

interface StepBody {
  readonly step: { readonly stepId: string } | null;
  readonly flowState: {
    readonly currentStep: string | null;
    readonly visibleQuestions: readonly string[];
    readonly missingRequired: readonly string[];
    readonly readyToSubmit: boolean;
  };
  readonly rosters: readonly { readonly groupId: string; readonly instances: readonly string[] }[];
  /** Which VIEW this response draws (task 076, ADR-28 as amended 2026-09-29). */
  readonly view: { readonly groupId: string | null; readonly instanceId: string | null };
  readonly progress: { readonly stepIndex: number; readonly totalVisibleSteps: number };
}

/** One session on a seeded form, and the bearer that reaches it. */
interface Session {
  readonly sessionId: string;
  readonly token: string;
}

async function newSession(formId: FormId, label: string): Promise<Session> {
  seeded += 1;
  const sessionId = SessionId.parse(`ses_only_${label}_${String(seeded)}`);
  await createSession(testDb.db, {
    // 064: a session belongs to an environment, and the data tables live in that
    // environment's schema. The harness's default is the one its search path names.
    environment: DEFAULT_TEST_ENVIRONMENT,
    sessionId,
    formId,
    formVersion: 1,
    accessMode: "anonymous",
    expiresAt: new Date(NOW.getTime() + 86_400_000),
  });
  const [signingKey] = await importSessionKeys(deps.config);
  const token = await mintSessionToken(
    sessionId,
    new Date(NOW.getTime() + 86_400_000),
    signingKey!,
  );
  return { sessionId, token };
}

/** One step read, with the ADR-28 cursor when a case supplies one. */
async function readStep(session: Session, cursor?: number): Promise<StepBody> {
  const query = cursor === undefined ? "" : `?step=${String(cursor)}`;
  const res = await app.request(`/sessions/${session.sessionId}/step${query}`, {
    headers: {
      "content-type": "application/json",
      "x-qcms-internal-token": internalToken,
      authorization: `Bearer ${session.token}`,
    },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as StepBody;
}

/** A fresh session's cursor-less first serve, with the roster ledger asserted. */
async function serve(formId: FormId): Promise<StepBody> {
  const session = await newSession(formId, "serve");
  const body = await readStep(session);
  // The roster LEDGER, not only the projection: what was minted has to be a fact about
  // the rows rather than about what the response chose to report. A group's step that is
  // served mints its `min`; one the serve has not reached mints nothing, which is the
  // mint gate working rather than the defect.
  const ledger = await rosterLedger(testDb.db, SessionId.parse(session.sessionId));
  expect(ledger.length).toBe(body.step?.stepId === "stp_only" ? 2 : 0);
  return body;
}

describe("a step whose every item is a repeating group is reachable (Q30)", () => {
  it("STACKED, the only step: it is served, and its min is minted", async () => {
    const formId = await publish(define("frm_only_stacked", "stacked", false), "only-stacked");
    const body = await serve(formId);
    // The step is drawn, `min: 2` is minted on this first serve, and the form does not
    // claim to be finished: two required plates are still missing. Before Q30 this was
    // `step: null`, `readyToSubmit: true` and an empty roster.
    expect(body.step?.stepId).toBe("stp_only");
    expect(body.flowState.currentStep).toBe("stp_only");
    expect(body.progress.totalVisibleSteps).toBe(1);
    expect(body.flowState.readyToSubmit).toBe(false);
    const live = body.rosters.find((entry) => entry.groupId === "grp_only")?.instances ?? [];
    expect(live).toHaveLength(2);
    // And the instances' fields are the page's content, which is what "reachable" means.
    for (const instanceId of live) {
      expect(body.flowState.visibleQuestions).toContain(`${instanceId}/q_rep_plate`);
    }
  });

  it("STACKED, behind a plain step: the group's step is in the view list and reachable", async () => {
    const formId = await publish(
      define("frm_only_stacked_lead", "stacked", true),
      "only-stacked-lead",
    );
    const body = await serve(formId);
    // Two visible steps, so a cursor names `stp_only` and a Continue arrives at it. This
    // is the case that shows why widening the mint gate alone would not have been the
    // fix: the step has to be in this list before any cursor can reach it.
    expect(body.progress.totalVisibleSteps).toBe(2);
    expect(body.step?.stepId).toBe("stp_lead");
    // The lead step's own required question is what makes it current, and the group's
    // step is the one after it rather than one the respondent can never get to. The
    // serve's unopened-group preference does not pull them forward onto it, because the
    // earlier of the two candidates wins.
    expect(body.flowState.currentStep).toBe("stp_lead");
  });

  it("GROUP FIRST, a required question after it: the first serve opens the group's step", async () => {
    // Q30's serve consequence (Code Owner, 2026-10-10). `currentStep` is frozen semantic
    // 5 - `firstMissingRequiredStep ?? firstIncompleteStep` - and an unminted group is
    // never in the first tier, so the LATER step's missing required answer wins it. The
    // serve corrects that for a cursor-less read: it prefers the first view whose step
    // holds a group this session has never opened.
    //
    // Without it a fresh session opened on "Step 2 of 2", with a Back button to a step it
    // had never seen, the group unminted, and Submit on the page - which the submission
    // sweep then refuses with `REPEAT_COUNT_OUT_OF_RANGE`.
    const formId = await publish(defineGroupFirst("frm_group_first"), "group-first");
    const body = await serve(formId);
    expect(body.step?.stepId).toBe("stp_only");
    expect(body.progress.stepIndex).toBe(0);
    expect(body.progress.totalVisibleSteps).toBe(2);
    // `min: 2` minted on this very serve, which is what being opened means.
    const live = body.rosters.find((entry) => entry.groupId === "grp_only")?.instances ?? [];
    expect(live).toHaveLength(2);
    // The kernel is untouched, and the projection is coherent rather than merely
    // overridden: the serve opened the step, the mint ran, so the re-evaluated flow has
    // this group's required plate missing and `currentStep` names this step on its own.
    // Before the mint the first tier named `stp_after`, which is what the serve passed
    // over; after it, the flow agrees with the page.
    expect(body.flowState.currentStep).toBe("stp_only");
    // Qualified, because the projection reports the answer KEY and a repeated question's
    // key carries its instance (`instanceId/questionId`).
    expect(
      body.flowState.missingRequired.filter((key) => key.endsWith("/q_rep_plate")),
    ).toHaveLength(2);
  });

  it("serves the EARLIER candidate, so a plain required step before the group still wins", async () => {
    // The narrowing taken deliberately against the ruling's wording. Read as an
    // unconditional first tier, the preference would mirror the harm it fixes: this form's
    // required question is on step 1 and its group on step 2, so a fresh session would
    // open on "Step 2 of 2" and the no-JS walk would then send the respondent backwards.
    // The two candidates are compared in document order instead.
    const formId = await publish(define("frm_lead_then_group", "stacked", true), "lead-then-group");
    const body = await serve(formId);
    expect(body.step?.stepId).toBe("stp_lead");
    expect(body.progress.stepIndex).toBe(0);
    // And the group is left unopened, because the serve never reached its step: the mint
    // is still gated on the step being rendered.
    expect(body.rosters.find((entry) => entry.groupId === "grp_only")?.instances).toEqual([]);
  });

  it("does NOT move an explicit cursor, even onto an unopened group's step", async () => {
    // The preference is for a cursor-less serve alone, or Back and Continue would be
    // overridden by it. A cursor of 1 draws the later step even though the group is still
    // unopened, and the group is still minted by the serve that named `stp_only` first.
    const formId = await publish(defineGroupFirst("frm_group_first_cursor"), "group-first-cursor");
    const session = await newSession(formId, "cursor");
    const withCursor = await readStep(session, 1);
    expect(withCursor.step?.stepId).toBe("stp_after");
    expect(withCursor.progress.stepIndex).toBe(1);
    // Nothing was minted, because the cursor named a step that holds no group: the mint
    // is still gated on the step being rendered.
    expect(withCursor.rosters.find((entry) => entry.groupId === "grp_only")?.instances).toEqual([]);
    // And the cursor-less read of the same session opens the group's step and mints it.
    const withoutCursor = await readStep(session);
    expect(withoutCursor.step?.stepId).toBe("stp_only");
    expect(
      withoutCursor.rosters.find((entry) => entry.groupId === "grp_only")?.instances,
    ).toHaveLength(2);
  });

  it("PER-INSTANCE, the only step: identical, so the fix is not this presentation's", async () => {
    const formId = await publish(define("frm_only_pi", "perInstanceStep", false), "only-pi");
    const body = await serve(formId);
    expect(body.step?.stepId).toBe("stp_only");
    expect(body.flowState.readyToSubmit).toBe(false);
    // `min: 2` minted, so the one step is TWO views and the cursor walks them.
    expect(body.progress.totalVisibleSteps).toBe(2);
    expect(body.view.groupId).toBe("grp_only");
    expect(body.view.instanceId).not.toBeNull();
  });
});
