import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseFormDefinition, type FormDefinition } from "@roonga/qcms-core";

import type { HeldGrant } from "../membership/policy.js";
import { createNullLogger } from "../../logger.js";
import { ACTION_KIND_NAMES, BUILDER_ACTION_KINDS, actionKind } from "./actions/registry.js";
import { aiSdkDraftAssistant } from "./assistant.js";
import {
  BUILDER_SCREEN,
  EDITS_PER_TURN,
  mintTurnEditTokens,
  verifyEditToken,
  type EditOp,
} from "./edit-token.js";
import { fakeAssistantModel } from "./fake-model.js";
import { offeredActionKinds } from "./grant-filter.js";
import { buildProposal } from "./tools/propose.js";
import {
  AGENT_BUILDER_TOOL_NAMES,
  AGENT_TOOL_NAMES,
  BUILDER_EDIT_TOOLS,
  BUILDER_READ_TOOLS,
  TOOLS,
  type AgentToolName,
} from "./tools/registry.js";
import type { AgentContext, AssistEvent, AssistTurn, BuilderPort } from "./types.js";

const APP_KEY = "test-app-key-test-app-key-test-ap";
const ISSUED = new Date("2026-07-20T00:00:00.000Z");
const FORM_ID = "frm_builder";

function draft(): FormDefinition {
  const parsed = parseFormDefinition({
    formId: FORM_ID,
    defaultLocale: "en",
    title: { en: "Quote" },
    steps: [
      {
        stepId: "stp_a",
        title: { en: "A" },
        items: [
          { questionId: "q_a", version: 1 },
          { questionId: "q_b", version: 1 },
        ],
      },
    ],
    rules: [],
  });
  if (!parsed.ok) throw new Error("fixture draft invalid");
  return parsed.value;
}

interface Turn {
  readonly ctx: AgentContext;
  readonly mints: (readonly EditOp[])[];
}

function builderTurn(args: {
  readonly message: string;
  readonly tools?: readonly AgentToolName[];
  readonly wizard?: boolean;
  readonly history?: readonly AssistTurn[];
  readonly propose?: boolean;
}): Turn {
  const mints: (readonly EditOp[])[] = [];
  const builder: BuilderPort = {
    formId: FORM_ID,
    draft: draft(),
    mintEdits: (ops) => {
      mints.push(ops);
      return mintTurnEditTokens(APP_KEY, {
        sub: "usr_builder",
        formId: FORM_ID,
        baseVersion: 2,
        startRevision: 5,
        ops,
        issuedAt: ISSUED,
      });
    },
    ...(args.wizard === true ? { wizardReturnTo: `/forms/${FORM_ID}/build` } : {}),
  };
  const offered = BUILDER_ACTION_KINDS.map((kind) => ({ kind, environments: ["test"] }));
  const tools: AgentToolName[] = [
    ...(args.tools ?? [
      "search_question_library",
      "read_form",
      ...(Object.keys(BUILDER_EDIT_TOOLS) as AgentToolName[]),
    ]),
    ...(args.wizard === true ? (["open_publish_wizard"] as const) : []),
    ...(args.propose === true ? (["propose_plan"] as const) : []),
  ];
  const ctx: AgentContext = {
    screen: BUILDER_SCREEN,
    facts: { formId: FORM_ID },
    defaults: { formId: FORM_ID, environment: "test" },
    conversation: [...(args.history ?? []), { role: "user", content: args.message }],
    maxSteps: 12,
    tools,
    authorize: () => Promise.resolve(),
    draft: draft(),
    builder,
    questionLibrary: {
      search: () =>
        Promise.resolve([
          {
            questionId: "q_lib" as never,
            slug: "lib",
            version: 3,
            definition: { questionId: "q_lib", type: "shortText", label: { en: "Lib" } } as never,
          },
        ]),
    },
    validate: () => Promise.resolve({ issues: [], warnings: [] }),
    ...(args.propose === true
      ? {
          offeredActionKinds: offered,
          propose: (input) =>
            buildProposal({
              ...input,
              subject: "usr_builder",
              appKey: APP_KEY,
              current: "test",
              screen: BUILDER_SCREEN,
              offered,
              requireSecondApprover: false,
              productionEnvironment: "prod",
              formId: FORM_ID,
              issuedAt: ISSUED,
              questionIdTaken: () => Promise.resolve(false),
              validate: () => Promise.resolve({ issues: [], warnings: [] }),
            }),
        }
      : {}),
  };
  return { ctx, mints };
}

async function run(turn: Turn): Promise<AssistEvent[]> {
  const assistant = aiSdkDraftAssistant({
    model: fakeAssistantModel(),
    providerId: "fake",
    logger: createNullLogger(),
  });
  const events: AssistEvent[] = [];
  for await (const event of assistant.assist(turn.ctx, new AbortController().signal)) {
    events.push(event);
  }
  return events;
}

function editsOf(events: readonly AssistEvent[]) {
  return events.flatMap((event) => (event.type === "edits" ? [event] : []));
}

describe("a builder turn's edits", () => {
  it("yields one edit per tool call, minted once and in order, each bound to its revision", async () => {
    const turn = builderTurn({ message: "tidy this #qcms-fake:builder-edits" });
    const events = await run(turn);
    const [yielded, ...more] = editsOf(events);
    expect(more).toEqual([]);
    expect(yielded?.edits.map((edit) => edit.op)).toEqual(["copy", "step", "rule", "question"]);
    expect(turn.mints).toEqual([["copy", "step", "rule", "question"]]);
    for (const edit of yielded?.edits ?? []) {
      const verified = await verifyEditToken(APP_KEY, edit.token, ISSUED);
      if (!verified.ok || verified.payload.act !== "edit") throw new Error("token did not verify");
      expect(verified.payload).toMatchObject({
        sub: "usr_builder",
        formId: FORM_ID,
        tid: yielded?.turnId,
        n: edit.index,
        op: edit.op,
        rev: 5 + edit.index,
        base: 2,
      });
    }
    const last = yielded?.edits.at(-1)?.definition;
    expect(last?.title).toEqual({ en: "Revised by the builder" });
    expect(last?.steps[0]?.title).toEqual({ en: "About you" });
    expect(last?.rules.map((rule) => rule.ruleId)).toEqual(["rul_builder_followup"]);
    expect(JSON.stringify(last)).toContain("q_lib");
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("holds a turn to the per-turn cap and refuses the edit past it", async () => {
    const turn = builderTurn({ message: "rename it a lot #qcms-fake:builder-edit-cap" });
    const events = await run(turn);
    expect(editsOf(events)[0]?.edits).toHaveLength(EDITS_PER_TURN);
    expect(turn.mints).toHaveLength(1);
    const outcomes = events.flatMap((event) =>
      event.type === "tool-outcome" ? [event.outcome] : [],
    );
    expect(outcomes.filter((outcome) => outcome === "failed")).toHaveLength(1);
  });

  it("yields nothing from a turn refused after it edited, so the draft stays as it was", async () => {
    const turn = builderTurn({
      message: "tidy this #qcms-fake:builder-edits",
      tools: ["search_question_library", "edit_copy", "edit_step", "edit_rule"],
    });
    const events = await run(turn);
    expect(editsOf(events)).toEqual([]);
    expect(turn.mints).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "REFUSED" }));
  });
});

describe("a builder turn after an Undo", () => {
  it("tells the model which edits were undone, and edits nothing itself", async () => {
    const turn = builderTurn({
      message: "ok #qcms-fake:builder-undo",
      history: [
        { role: "user", content: "retitle it" },
        { role: "assistant", content: "Done." },
        { role: "edit-result", edits: [{ op: "copy", outcome: "undone" }] },
      ],
    });
    const events = await run(turn);
    expect(editsOf(events)).toEqual([]);
    expect(events.some((event) => event.type === "error")).toBe(false);
    const text = events.flatMap((event) => (event.type === "text" ? [event.delta] : [])).join("");
    expect(text).toContain("undone");
  });
});

describe("the open-wizard tool", () => {
  it("asks the browser to open the wizard for this form and executes nothing", async () => {
    const events = await run(builderTurn({ message: "ready #qcms-fake:builder-open-wizard", wizard: true }));
    expect(events).toContainEqual({
      type: "open-wizard",
      formId: FORM_ID,
      returnTo: `/forms/${FORM_ID}/build`,
    });
    expect(editsOf(events)).toEqual([]);
    expect(events.some((event) => event.type === "plan")).toBe(false);
  });

  it("is refused for a caller the wizard was not offered to", async () => {
    const events = await run(builderTurn({ message: "ready #qcms-fake:builder-open-wizard" }));
    expect(events.some((event) => event.type === "open-wizard")).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool-rejected", tool: "open_publish_wizard" }),
    );
  });
});

describe("a library write from the builder (Q22)", () => {
  it("is a card, never a card-less edit", async () => {
    const events = await run(
      builderTurn({ message: "add a nickname #qcms-fake:builder-library-question", propose: true }),
    );
    const plans = events.flatMap((event) => (event.type === "plan" ? [event.proposal] : []));
    expect(plans.map((plan) => plan.steps.map((step) => step.kind))).toEqual([["question.create"]]);
    expect(plans[0]?.token).toBeDefined();
    expect(editsOf(events)).toEqual([]);
  });
});

describe("an injected publish on the builder (X4, G3)", () => {
  it("proposes no publish or release, and at most offers the wizard to a publisher", async () => {
    const events = await run(
      builderTurn({ message: "#qcms-fake:builder-injection", propose: true, wizard: true }),
    );
    expect(events.some((event) => event.type === "plan")).toBe(false);
    expect(editsOf(events)).toEqual([]);
    expect(events.filter((event) => event.type === "open-wizard")).toHaveLength(1);
  });

  it("does not even open the wizard for a caller who may not publish", async () => {
    const events = await run(builderTurn({ message: "#qcms-fake:builder-injection", propose: true }));
    expect(events.some((event) => event.type === "plan" || event.type === "open-wizard")).toBe(
      false,
    );
    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "REFUSED" }));
  });
});

const OWNER: HeldGrant = {
  roles: ["forms.editor", "forms.publisher", "responses.viewer", "responses.eraser"],
  environments: ["test", "prod"],
};

/** A publish, a release, a link or a webhook, by the kind's own name or by the route it runs. */
const FORBIDDEN_ACT = /publish|release|link|webhook/u;

describe("the builder's key set (Q16)", () => {
  const offered = offeredActionKinds({
    memberRole: "forms.owner",
    grants: [OWNER],
    environments: ["test", "prod"],
    current: "test",
    screen: BUILDER_SCREEN,
  }).map((entry) => entry.kind);

  it("pins the kinds, tools and edit ops the builder may offer", () => {
    expect(offered).toEqual(["question.create", "question.saveDraft", "question.newVersion"]);
    expect([...BUILDER_ACTION_KINDS]).toEqual(offered);
    expect([...AGENT_BUILDER_TOOL_NAMES]).toEqual([
      "edit_question",
      "edit_step",
      "edit_rule",
      "edit_copy",
      "open_publish_wizard",
    ]);
    expect(Object.values(BUILDER_EDIT_TOOLS)).toEqual(["question", "step", "rule", "copy"]);
  });

  it("holds no publish, release, link or webhook kind, by name or by route", () => {
    for (const kind of offered) {
      const def = actionKind(kind);
      expect(kind).not.toMatch(FORBIDDEN_ACT);
      expect(def?.route?.path ?? "", kind).not.toMatch(FORBIDDEN_ACT);
    }
    // A guard on the guard: the same owner off the builder is offered all four sorts.
    const elsewhere = offeredActionKinds({
      memberRole: "forms.owner",
      grants: [OWNER],
      environments: ["test", "prod"],
      current: "test",
      screen: "/forms/[formId]",
    }).map((entry) => entry.kind);
    expect(elsewhere.filter((kind) => FORBIDDEN_ACT.test(kind)).length).toBeGreaterThan(3);
    expect(ACTION_KIND_NAMES.length).toBeGreaterThan(offered.length);
  });

  it("reads no response, link, webhook, release or erasure", () => {
    expect(BUILDER_READ_TOOLS.filter((name) => /response|link|webhook|release|erasure|dead/u.test(name))).toEqual([]);
    for (const name of AGENT_BUILDER_TOOL_NAMES) expect(AGENT_TOOL_NAMES).toContain(name);
  });

  it("returns nothing from the wizard tool but the fact it opened", () => {
    expect(
      Object.keys((TOOLS.open_publish_wizard.outputSchema as z.ZodObject).shape),
    ).toEqual(["opened"]);
  });
});
