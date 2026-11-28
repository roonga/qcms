import { createAnthropic } from "@ai-sdk/anthropic";
import { parseQuestionDefinition, QuestionId } from "@roonga/qcms-core";
import {
  SEED_WORKSPACE_ID,
  createQuestion,
  createQuestionVersion,
  publishQuestionVersion,
} from "@roonga/qcms-db";
import { startTestDb, type TestDb } from "@roonga/qcms-db/testing";

import { createApp } from "../src/app.js";
import type { Deps } from "../src/deps.js";
import { aiSdkDraftAssistant } from "../src/features/agent/assistant.js";
import { cacheBreakpointOptions } from "../src/features/agent/caching.js";
import { registerAgentProvenance } from "../src/features/agent/provenance-mount.js";
import { registerAgentChanges, registerFormsAssist } from "../src/features/agent/route.js";
import { SYSTEM_PROMPT_VERSION } from "../src/features/agent/system-prompt.js";
import { thinkingProviderOptions } from "../src/features/agent/thinking.js";
import type { AssistEvent, AssistTurn } from "../src/features/agent/types.js";
import { registerForms } from "../src/features/forms/route.js";
import { registerGrantCheck } from "../src/features/membership/middleware.js";
import { registerQuestions } from "../src/features/questions/route.js";
import { createNullLogger } from "../src/logger.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../src/middleware/admin-auth.js";
import {
  REQUEST_ENVIRONMENT_HEADER,
  registerRequestEnvironment,
} from "../src/middleware/request-environment.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../src/test-support.js";
import type { Usage } from "./budget.js";
import type { EvalConfig } from "./config.js";
import { createRecorder, type ModelRecorder } from "./recorder.js";
import type { EvalScenario } from "./scenarios.js";
import {
  TRACE_VERSION,
  replyOf,
  reportedModelOf,
  usageOfTurn,
  type ScenarioTrace,
  type TurnTrace,
} from "./trace.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

const SEED_AT = new Date("2026-07-20T00:00:00.000Z");

/** Stops a new turn starting once the run has spent its cap, and takes what each turn spent. */
export interface BudgetGate {
  allow(): boolean;
  charge(usage: Usage): void;
}

export interface RunFactsForTrace {
  readonly runId: string;
  readonly gitSha: string;
  readonly graderModel: string;
}

export interface EvalHarness {
  readonly promptVersion: number;
  runScenario(
    scenario: EvalScenario,
    rep: number,
    facts: RunFactsForTrace,
    gate: BudgetGate,
  ): Promise<ScenarioTrace>;
  teardown(): Promise<void>;
}

type Caller = { token: string; userId: string };

function definition(formId: string): Record<string, unknown> {
  return {
    formId,
    defaultLocale: "en",
    title: { en: "Larkmead new patient sign-up" },
    steps: [
      {
        stepId: "stp_about_you",
        title: { en: "About you" },
        items: [{ questionId: "q_eval_name", version: 1 }],
      },
      {
        stepId: "stp_contact",
        title: { en: "How we reach you" },
        items: [{ questionId: "q_eval_email", version: 1 }],
      },
    ],
    rules: [],
  };
}

function eventsOf(body: string): AssistEvent[] {
  return (
    body
      .split("\n\n")
      .map((chunk) => chunk.split("\n").find((line) => line.startsWith("data: ")))
      .filter((line): line is string => line !== undefined)
      // The route serialised each frame from an `AssistEvent` one call ago and nothing else
      // writes this stream, so the frames are those events rather than arbitrary JSON.
      .map((line) => JSON.parse(line.slice("data: ".length)) as AssistEvent)
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A repetition that stopped part way, carrying the turns and the usage it reached. */
export class ScenarioRunError extends Error {
  readonly trace: ScenarioTrace;

  constructor(message: string, trace: ScenarioTrace, cause: unknown) {
    super(message, { cause });
    this.name = "ScenarioRunError";
    this.trace = trace;
  }
}

export async function startHarness(options: {
  readonly key: string;
  readonly config: EvalConfig;
}): Promise<EvalHarness> {
  const { key, config } = options;
  const providerOptions = thinkingProviderOptions("anthropic", config.thinking);
  const cacheBreakpoint = cacheBreakpointOptions("anthropic");
  const testDb: TestDb = await startTestDb();
  const recorder: ModelRecorder = createRecorder();
  const logger = createNullLogger();
  const model = recorder.wrap(createAnthropic({ apiKey: key })(config.model));

  const deps: Deps = makeDeps({
    db: testDb.db,
    env: validEnv({
      QCMS_FLAG_AGENT_AUTHORING: "anthropic",
      QCMS_AGENT_MODEL: config.model,
      QCMS_AGENT_API_KEY: key,
      QCMS_AGENT_THINKING: config.thinking,
    }),
    logger,
    clock: { now: () => SEED_AT },
    draftAssistant: aiSdkDraftAssistant({
      model,
      providerId: "anthropic",
      logger,
      thinking: config.thinking,
      ...(providerOptions === undefined ? {} : { providerOptions }),
      ...(cacheBreakpoint === undefined ? {} : { cacheBreakpoint }),
    }),
  });

  const app = createApp(deps, ADMIN_ONLY, {
    groups: {
      admin: [
        registerAdminAuth,
        registerRequestEnvironment,
        registerGrantCheck,
        registerAgentProvenance,
        registerQuestions,
        registerForms,
        registerFormsAssist,
        registerAgentChanges,
      ],
    },
  });
  const internalToken = internalTokenFor(deps.config);

  const headersFor = (caller: Caller): Record<string, string> => ({
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: caller.token,
    [REQUEST_ENVIRONMENT_HEADER]: "test",
  });

  const owner = await seedAdminSession(testDb.db, { label: "eval_owner", at: SEED_AT });

  for (const [id, label] of [
    ["q_eval_name", "Your name"],
    ["q_eval_email", "Email address"],
  ] as const) {
    const questionId = QuestionId.parse(id);
    const parsed = parseQuestionDefinition({
      questionId: id,
      type: "shortText",
      label: { en: label },
    });
    if (!parsed.ok) throw new Error(`the eval fixture question ${id} did not parse`);
    await createQuestion(testDb.db, {
      workspaceId: SEED_WORKSPACE_ID,
      questionId,
      slug: id.replaceAll("_", "-"),
    });
    await createQuestionVersion(testDb.db, { questionId, definition: parsed.value });
    await publishQuestionVersion(testDb.db, { questionId, version: 1 });
  }

  async function seedForm(formId: string): Promise<void> {
    const created = await app.request("/admin/forms", {
      method: "POST",
      headers: headersFor(owner),
      body: JSON.stringify({
        formId,
        slug: formId.replaceAll("_", "-"),
        defaultLocale: "en",
      }),
    });
    if (created.status !== 201)
      throw new Error(`the eval fixture form was not created: ${String(created.status)}`);
    const saved = await app.request(`/admin/forms/${formId}/draft`, {
      method: "PUT",
      headers: headersFor(owner),
      body: JSON.stringify({ definition: definition(formId) }),
    });
    if (saved.status !== 200)
      throw new Error(`the eval fixture draft was not saved: ${String(saved.status)}`);
  }

  async function turn(
    caller: Caller,
    formId: string,
    screen: string,
    conversation: readonly AssistTurn[],
    conversationId: string,
  ): Promise<AssistEvent[]> {
    await deps.rateLimitStore.reset(`rl:agent-assist:${caller.userId}`);
    const res = await app.request(`/admin/forms/${formId}/draft/assist`, {
      method: "POST",
      headers: headersFor(caller),
      body: JSON.stringify({ conversation, screen, conversationId }),
    });
    if (res.status !== 200) throw new Error(`the assist turn answered ${String(res.status)}`);
    return eventsOf(await res.text());
  }

  return {
    promptVersion: SYSTEM_PROMPT_VERSION,

    async runScenario(scenario, rep, facts, gate) {
      const startedAt = new Date().toISOString();
      const formId = `frm_eval_${scenario.id.toLowerCase()}_${String(rep)}`;
      const conversation: AssistTurn[] = [];
      const turns: TurnTrace[] = [];
      let pending: { index: number; message: string } | undefined;

      const traceOf = (): ScenarioTrace => ({
        version: TRACE_VERSION,
        runId: facts.runId,
        scenarioId: scenario.id,
        rep,
        safety: scenario.safety,
        models: {
          requested: config.model,
          reported: reportedModelOf(turns.flatMap((traced) => traced.calls)),
          grader: facts.graderModel,
        },
        thinking: config.thinking,
        promptVersion: SYSTEM_PROMPT_VERSION,
        gitSha: facts.gitSha,
        startedAt,
        finishedAt: new Date().toISOString(),
        turns,
      });

      try {
        await seedForm(formId);
        const caller = await seedAdminSession(testDb.db, {
          label: `eval_${scenario.id.toLowerCase()}_${String(rep)}`,
          at: SEED_AT,
          grants: [...scenario.caller.grants],
          owner: scenario.caller.owner,
        });

        recorder.takeCalls();

        for (const [index, message] of scenario.messages.entries()) {
          if (!gate.allow()) break;
          pending = { index: index + 1, message };
          conversation.push({ role: "user", content: message });
          const events = await turn(
            caller,
            formId,
            scenario.screen,
            conversation,
            `cnv_eval_${scenario.id.toLowerCase()}_${String(rep)}`,
          );
          const traced: TurnTrace = {
            index: index + 1,
            message,
            calls: recorder.takeCalls(),
            events,
          };
          turns.push(traced);
          pending = undefined;
          gate.charge(usageOfTurn(traced));
          // A turn can end with a card and no words, and the route takes no empty content.
          const reply = replyOf(traced);
          if (reply !== "") conversation.push({ role: "assistant", content: reply });
        }
      } catch (error) {
        const spent = recorder.takeCalls();
        if (pending !== undefined || spent.length > 0) {
          // The run paid the provider for the failing turn, so it is charged and kept.
          const traced: TurnTrace = {
            index: pending?.index ?? turns.length + 1,
            message: pending?.message ?? "",
            calls: spent,
            events: [],
          };
          turns.push(traced);
          gate.charge(usageOfTurn(traced));
        }
        throw new ScenarioRunError(
          `${scenario.id} repetition ${String(rep)} stopped: ${messageOf(error)}`,
          traceOf(),
          error,
        );
      }

      return traceOf();
    },

    async teardown() {
      await testDb.teardown();
    },
  };
}
