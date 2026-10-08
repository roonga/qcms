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
  // The roster LEDGER, not only the projection: what was minted has to be a fact about
  // the rows rather than about what the response chose to report. A group-only step that
  // is served mints its `min`; one behind a plain step is not served yet and mints
  // nothing, which is the mint gate working rather than the defect.
  const ledger = await rosterLedger(testDb.db, sessionId);
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
    // step is the one after it rather than one the respondent can never get to.
    expect(body.flowState.currentStep).toBe("stp_lead");
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
