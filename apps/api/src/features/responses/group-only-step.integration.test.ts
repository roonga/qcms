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
  SEED_WORKSPACE_ID,
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
  app = createApp(deps, PUBLIC_ONLY, { groups: { respondent: [registerServeStep] } });
  internalToken = internalTokenFor(deps.config);
  for (const question of QUESTIONS) {
    await createQuestion(testDb.db, {
      workspaceId: SEED_WORKSPACE_ID,
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
  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId,
    slug,
    defaultLocale: "en",
  });
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
  readonly view: { readonly groupId: string | null; readonly instanceId: string | null };
  readonly progress: { readonly stepIndex: number; readonly totalVisibleSteps: number };
}

interface Session {
  readonly sessionId: string;
  readonly token: string;
}

async function newSession(formId: FormId, label: string): Promise<Session> {
  seeded += 1;
  const sessionId = SessionId.parse(`ses_only_${label}_${String(seeded)}`);
  await createSession(testDb.db, {
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

async function serve(formId: FormId): Promise<StepBody> {
  const session = await newSession(formId, "serve");
  const body = await readStep(session);
  // The mint is gated on the step being served, so a serve that did not reach the
  // group's step mints nothing.
  const ledger = await rosterLedger(testDb.db, SessionId.parse(session.sessionId));
  expect(ledger.length).toBe(body.step?.stepId === "stp_only" ? 2 : 0);
  return body;
}

describe("a step whose every item is a repeating group is reachable (Q30)", () => {
  it("STACKED, the only step: it is served, and its min is minted", async () => {
    const formId = await publish(define("frm_only_stacked", "stacked", false), "only-stacked");
    const body = await serve(formId);
    expect(body.step?.stepId).toBe("stp_only");
    expect(body.flowState.currentStep).toBe("stp_only");
    expect(body.progress.totalVisibleSteps).toBe(1);
    expect(body.flowState.readyToSubmit).toBe(false);
    const live = body.rosters.find((entry) => entry.groupId === "grp_only")?.instances ?? [];
    expect(live).toHaveLength(2);
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
    expect(body.progress.totalVisibleSteps).toBe(2);
    expect(body.step?.stepId).toBe("stp_lead");
    expect(body.flowState.currentStep).toBe("stp_lead");
  });

  it("GROUP FIRST, a required question after it: the first serve opens the group's step", async () => {
    const formId = await publish(defineGroupFirst("frm_group_first"), "group-first");
    const body = await serve(formId);
    expect(body.step?.stepId).toBe("stp_only");
    expect(body.progress.stepIndex).toBe(0);
    expect(body.progress.totalVisibleSteps).toBe(2);
    const live = body.rosters.find((entry) => entry.groupId === "grp_only")?.instances ?? [];
    expect(live).toHaveLength(2);
    expect(body.flowState.currentStep).toBe("stp_only");
    expect(
      body.flowState.missingRequired.filter((key) => key.endsWith("/q_rep_plate")),
    ).toHaveLength(2);
  });

  it("serves the EARLIER candidate, so a plain required step before the group still wins", async () => {
    const formId = await publish(define("frm_lead_then_group", "stacked", true), "lead-then-group");
    const body = await serve(formId);
    expect(body.step?.stepId).toBe("stp_lead");
    expect(body.progress.stepIndex).toBe(0);
    expect(body.rosters.find((entry) => entry.groupId === "grp_only")?.instances).toEqual([]);
  });

  it("does NOT move an explicit cursor, even onto an unopened group's step", async () => {
    const formId = await publish(defineGroupFirst("frm_group_first_cursor"), "group-first-cursor");
    const session = await newSession(formId, "cursor");
    const withCursor = await readStep(session, 1);
    expect(withCursor.step?.stepId).toBe("stp_after");
    expect(withCursor.progress.stepIndex).toBe(1);
    expect(withCursor.rosters.find((entry) => entry.groupId === "grp_only")?.instances).toEqual([]);
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
    expect(body.progress.totalVisibleSteps).toBe(2);
    expect(body.view.groupId).toBe("grp_only");
    expect(body.view.instanceId).not.toBeNull();
  });
});
