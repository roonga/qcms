/**
 * **A step whose every item is a repeating group is unreachable. This file pins that
 * defect rather than endorsing it**, and every expectation below is labelled with the
 * answer it should give instead (found by task 076, 2026-10-02; awaiting a Code Owner
 * ruling, see `docs/features/076-per-instance-step.md`).
 *
 * ## What happens
 *
 * `visibleSteps` is derived from `visible`, so a step whose only content is a repeating
 * group with an **empty roster** has nothing visible and is not a visible step. The
 * roster is empty because the mint is due "the first time the group's own step is
 * served" (`mintDueAndLoadRosters`), and the step is never served because it is not
 * visible. The two facts hold each other up: it is a fixpoint of emptiness, and nothing
 * a respondent does breaks it.
 *
 * The consequence a respondent meets is in the first case below: a form whose single
 * step is a repeating group answers its very first request with `step: null` and
 * `readyToSubmit: true` - "you have answered everything", before they have answered
 * anything, with no control that could change it.
 *
 * ## Why it is pinned here and not fixed here
 *
 * **It is a defect of merged code and not of this presentation.** The second and third
 * cases are the evidence: the **stacked** presentation reaches it identically, and it
 * reaches it whether the group's step stands alone or sits behind a plain step.
 * `apps/api/src/features/responses/roster.ts` is byte-identical to the commit this work
 * branched from, and the kernel's `visibleSteps` is untouched by this task.
 *
 * **And the natural fix is a Code Owner decision.** It is to make a step holding a
 * repeating group a visible step even with an empty roster, because the group's own
 * chrome - its label and its Add control - is content a respondent can act on, and
 * because `visibleStepViews` already reads that way ("a step carrying such a group with
 * an empty roster contributes one view with a null instance"). That is a change to
 * `visibleSteps`, and the committed golden scenario
 * `packages/core/golden/evaluator/scenarios/repeat-every-instance-empty-group.json`
 * pins the current reading: its form's `stp_pax` is a group-only step, its roster is
 * empty, and its `expected.visibleSteps` is `["stp_after"]`. Changing it means editing
 * an `expected` block, which `pnpm check:golden-append-only` forbids and which task
 * 071's exit criteria protect by name. Widening only the mint gate is not an
 * alternative: the third case here shows the step stays out of `visibleSteps`, so the
 * cursor can never reach it however the roster is filled.
 *
 * Until it is ruled on, **every repeat fixture needs one non-group question on the
 * step**, which is what `repeat-fleet` has and what `repeat-tour` was given.
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
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
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
    readonly readyToSubmit: boolean;
  };
  readonly rosters: readonly { readonly groupId: string; readonly instances: readonly string[] }[];
  readonly progress: { readonly stepIndex: number; readonly totalVisibleSteps: number };
}

async function serve(formId: FormId): Promise<StepBody> {
  seeded += 1;
  const sessionId = SessionId.parse(`ses_only_${String(seeded)}`);
  await createSession(testDb.db, {
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
  const res = await app.request(`/sessions/${sessionId}/step`, {
    headers: {
      "content-type": "application/json",
      "x-qcms-internal-token": internalToken,
      authorization: `Bearer ${token}`,
    },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as StepBody;
  // The roster LEDGER, not only the projection: "nothing was minted" has to be a fact
  // about the rows rather than about what the response chose to report.
  expect(await rosterLedger(testDb.db, sessionId)).toHaveLength(0);
  return body;
}

describe("a step whose every item is a repeating group is unreachable (defect, pinned)", () => {
  it("STACKED, the only step: the first request says the form is already complete", async () => {
    const formId = await publish(define("frm_only_stacked", "stacked", false), "only-stacked");
    const body = await serve(formId);
    // SHOULD BE: the step, with `min: 2` minted, and `readyToSubmit` false until the two
    // plates are answered. IS: nothing to draw, and a form that reports itself finished
    // before the respondent has answered anything.
    expect(body.step).toBeNull();
    expect(body.flowState.readyToSubmit).toBe(true);
    expect(body.progress.totalVisibleSteps).toBe(0);
    // Nothing was minted, which is the other half of the fixpoint: the mint is due on
    // the serve of this step, and this step is never served.
    expect(body.rosters).toEqual([{ groupId: "grp_only", instances: [] }]);
  });

  it("STACKED, behind a plain step: the group's step is not even in the view list", async () => {
    const formId = await publish(
      define("frm_only_stacked_lead", "stacked", true),
      "only-stacked-lead",
    );
    const body = await serve(formId);
    // The lead step serves, so this session is not stuck at the first request. What it
    // can never do is reach the group's step: one visible step out of two, so there is no
    // cursor position that names `stp_only` and no Continue that arrives at it. This is
    // why widening the mint gate alone would not fix the defect.
    expect(body.step?.stepId).toBe("stp_lead");
    // SHOULD BE: 2.
    expect(body.progress.totalVisibleSteps).toBe(1);
  });

  it("PER-INSTANCE, the only step: identical, so the defect is not this presentation's", async () => {
    const formId = await publish(define("frm_only_pi", "perInstanceStep", false), "only-pi");
    const body = await serve(formId);
    expect(body.step).toBeNull();
    expect(body.flowState.readyToSubmit).toBe(true);
  });
});
