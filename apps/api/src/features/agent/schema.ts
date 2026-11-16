import { z } from "@hono/zod-openapi";
import { FormId, InstanceId, QuestionId, StepId } from "@roonga/qcms-core";

import { SavedDraftResponse } from "../forms/schema.js";
import { ACTION_KIND_NAMES, actionKind } from "./actions/registry.js";
import { EDITS_PER_TURN } from "./edit-token.js";
import { BUILDER_EDIT_OPS } from "./tools/edit.js";

export const AssistTurnBody = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8_000),
});

/** Scalars only: an object or an array is how content smuggles itself into a metadata channel. */
const ResultValue = z.union([z.string().max(200), z.number(), z.boolean()]);

/**
 * Every field name any registered kind may report, so the result object is closed rather
 * than an open map: an undeclared key is refused by the schema, and `stepResultRefusal`
 * narrows the declared ones to the reporting kind's own list.
 */
const RESULT_FIELD_NAMES: readonly string[] = [
  ...new Set(ACTION_KIND_NAMES.flatMap((name) => actionKind(name)?.resultAllowlist ?? [])),
].sort((a, b) => a.localeCompare(b));

export const ActionStepResultBody = z.strictObject({
  kind: z.string().min(1).max(100),
  outcome: z.enum(["done", "failed", "pending-approval", "not-run", "cancelled", "expired"]),
  result: z
    .strictObject(
      Object.fromEntries(RESULT_FIELD_NAMES.map((field) => [field, ResultValue.optional()])),
    )
    .optional(),
});

export type ActionStepResult = z.infer<typeof ActionStepResultBody>;

/**
 * The per-kind narrowing of one step's reported result, run by the route so the schema itself stays a plain closed
 * object. Checked server side as well as filtered by the card: a client reporting a field outside the kind's list
 * would be the one path a minted URL or a rotated secret could take back into the conversation.
 */
export function stepResultRefusal(step: ActionStepResult): string | undefined {
  const allowed = actionKind(step.kind)?.resultAllowlist;
  if (allowed === undefined) return `There is no action kind named "${step.kind}".`;
  for (const field of Object.keys(step.result ?? {})) {
    if (!allowed.includes(field)) {
      return `"${step.kind}" does not report a field named "${field}".`;
    }
  }
  return undefined;
}

/**
 * The `action-result` turn: what ran, what failed and what did not run, in order. It
 * carries no answer value, no payload and no secret, and the admin writes it rather than
 * the model.
 */
export const ActionResultTurnBody = z.strictObject({
  role: z.literal("action-result"),
  proposalId: z.string().min(1).max(64),
  steps: z.array(ActionStepResultBody).min(1).max(25),
});

/**
 * The `proposal` turn: a card the person has already been shown and has not yet confirmed
 * or dismissed. Only the browser knows a card is still waiting, so only the browser can
 * say so, and it says it in step kinds alone: the words describing the card are the
 * model's own, already in the conversation above it.
 */
export const WaitingProposalTurnBody = z.strictObject({
  role: z.literal("proposal"),
  proposalId: z.string().min(1).max(64),
  steps: z
    .array(z.strictObject({ kind: z.string().min(1).max(100) }))
    .min(1)
    .max(25),
});

/**
 * The `edit-result` turn: what became of the builder's last edits, which only the browser
 * knows. Ops and outcomes only: the edits' content is the draft, which the turn reads itself.
 */
export const EditResultTurnBody = z.strictObject({
  role: z.literal("edit-result"),
  edits: z
    .array(
      z.strictObject({
        op: z.enum(BUILDER_EDIT_OPS),
        outcome: z.enum(["applied", "undone", "failed", "not-run"]),
      }),
    )
    .min(1)
    .max(EDITS_PER_TURN),
});

/**
 * A filter date the response query can use. Parsed here because `new Date` on an
 * unparsable string reaches the query as `Invalid Date` and fails as a 500.
 */
const FilterDate = z
  .string()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Not a date" });

/**
 * Accept screen and route ids only; the server computes accessible context so a client cannot inject content
 * outside its screen.
 */
const ScreenParamsBody = z.strictObject({
  formId: z.string().max(200).optional(),
  questionId: z.string().max(200).optional(),
  workspaceId: z.string().max(200).optional(),
  sessionId: z.string().max(200).optional(),
  version: z.number().int().min(1).max(1_000_000).optional(),
  /** The response list's own four filters, none of which takes an answer value. */
  filters: z
    .strictObject({
      version: z.number().int().min(1).max(1_000_000).optional(),
      from: FilterDate.optional(),
      to: FilterDate.optional(),
      flagged: z.boolean().optional(),
    })
    .optional(),
});

export type ConversationTurnBody =
  | z.infer<typeof AssistTurnBody>
  | z.infer<typeof ActionResultTurnBody>
  | z.infer<typeof WaitingProposalTurnBody>
  | z.infer<typeof EditResultTurnBody>;

function firstRefusal<T>(
  steps: readonly T[],
  refusalOf: (step: T) => string | undefined,
): string | undefined {
  for (const step of steps) {
    const refusal = refusalOf(step);
    if (refusal !== undefined) return refusal;
  }
  return undefined;
}

function turnRefusal(turn: ConversationTurnBody): string | undefined {
  if (turn.role === "proposal") {
    return firstRefusal(turn.steps, ({ kind }) =>
      actionKind(kind) === undefined ? `There is no action kind named "${kind}".` : undefined,
    );
  }
  if (turn.role !== "action-result") return undefined;
  return firstRefusal(turn.steps, stepResultRefusal);
}

export function conversationRefusal(
  conversation: readonly ConversationTurnBody[],
): string | undefined {
  return firstRefusal(conversation, turnRefusal);
}

// Capped because an unbounded history is an unbounded upstream bill.
const ConversationBody = z
  .array(
    z.union([AssistTurnBody, ActionResultTurnBody, WaitingProposalTurnBody, EditResultTurnBody]),
  )
  .min(1)
  .max(40);

const screenRef = {
  screen: z.string().min(1).max(200),
  params: ScreenParamsBody.optional(),
  /**
   * Random, minted by the admin when a conversation starts. The key an audited read is
   * deduplicated by, never an identity: a forged one adds a row or lands on a key this same
   * user already holds, and can never leave a read unrecorded.
   */
  conversationId: z.string().min(1).max(64),
  /**
   * The conversation's current stay on one subject. It joins the dedup key, so a return to
   * a subject owes a new row; a forged one adds a row or skips a stay this same user
   * already has a row for in that environment, and leaves none unrecorded.
   */
  visitId: z.string().min(1).max(64).optional(),
};

export const AssistBody = z
  .strictObject({
    conversation: ConversationBody,
    // The draft `updatedAt` the client proposed against; a mismatch is refused.
    clientState: z.string().max(64).optional(),
    // Optional here and required on the screen route: this route is the builder's own,
    // so a turn that names no screen is a turn on the builder. A named screen must be one
    // of this form's subtree.
    screen: screenRef.screen.optional(),
    params: screenRef.params,
    // Absent means no deduplication rather than a shared key, which is the safe
    // direction: an audited read then writes its row for every turn.
    conversationId: screenRef.conversationId.optional(),
    visitId: screenRef.visitId,
  })
  .openapi("AssistRequest");

/** A turn on a screen with no form in its route: the screen id decides what it may read. */
export const ScreenAssistBody = z
  .strictObject({
    conversation: ConversationBody,
    ...screenRef,
  })
  .openapi("ScreenAssistRequest");

// Opaque so an invalid definition reaches the kernel and earns its 422 rather than a bare 400.
// Unnamed because this flag-gated route must not register a component into a default build's document.
const OpaqueQuestionDefinition = z.record(z.string(), z.unknown());

/**
 * New question definitions travel with the draft that pins them because both must be
 * stored in one transaction; otherwise a draft can pin a question no create produced.
 */
export const AcceptProposalBody = z
  .strictObject({
    definition: OpaqueQuestionDefinition,
    // Capped at `propose_questions`' own ceiling.
    newQuestions: z
      .array(
        z.strictObject({
          definition: OpaqueQuestionDefinition,
          slug: z.string().min(1).max(200).optional(),
        }),
      )
      .max(50)
      .default([]),
  })
  .openapi("AcceptProposalBody");

const CreatedQuestionDraft = z.object({
  questionId: z.string().openapi({ example: "q_first_name" }),
  slug: z.string().openapi({ example: "first-name" }),
  version: z.number().int().openapi({ example: 1 }),
  status: z.literal("draft"),
});

/** Extends the save response so the builder's existing save handling reads this unchanged. */
export const AcceptProposalResponse = SavedDraftResponse.extend({
  createdQuestions: z.array(CreatedQuestionDraft),
}).openapi("AcceptProposalResponse");

const AgentChange = z.object({
  kind: z.string().openapi({ example: "draft.question" }),
  /** The draft revision the change left, for a card-less edit or Undo; null for a card step. */
  revision: z.number().int().nullable(),
  confirmedAt: z.string().openapi({ example: "2026-08-01T09:00:00.000Z" }),
});

export const AgentChangesResponse = z
  .object({
    formId: z.string().openapi({ example: "frm_contact" }),
    /** The newest published version, which is the last revision a human reviewed; null before the first publish. */
    base: z
      .object({
        version: z.number().int(),
        publishedAt: z.string(),
        definition: z.unknown(),
        appearance: z.unknown(),
      })
      .nullable(),
    draft: z
      .object({ revision: z.number().int(), definition: z.unknown(), appearance: z.unknown() })
      .nullable(),
    /** From the audit rows alone: true when any agent change is recorded since `base`. */
    agentAssisted: z.boolean(),
    changes: z.array(AgentChange),
  })
  .openapi("AgentChangesResponse");

/** An id slot in a builder fact is bounded like every other slot, so it cannot carry a long string. */
export const FACT_ID_MAX = 128;

const FactFormId = FormId.max(FACT_ID_MAX);
const FactStepId = StepId.max(FACT_ID_MAX);
const FactQuestionId = QuestionId.max(FACT_ID_MAX);
const FactInstanceId = InstanceId.max(FACT_ID_MAX);

const PreviewDevice = z.enum(["phone", "tablet", "desktop", "custom"]);

const Viewport = z.strictObject({
  width: z.number().int().min(200).max(4_000),
  height: z.number().int().min(200).max(4_000),
});

/**
 * The question the user pointed at in the builder preview (G1). Ids and enums only: no
 * label, no answer and no free string, so nothing authored or entered travels in it.
 */
export const PreviewSelectionFact = z.strictObject({
  fact: z.literal("preview-selection"),
  formId: FactFormId,
  stepId: FactStepId,
  questionId: FactQuestionId,
  instanceId: FactInstanceId.optional(),
  device: PreviewDevice,
  viewport: Viewport,
});

export type PreviewSelectionFact = z.infer<typeof PreviewSelectionFact>;

export const LAYOUT_ISSUES = [
  "overflow-horizontal",
  "clipped",
  "truncated-label",
  "target-too-small",
  "overlap",
  "off-screen",
] as const;

/**
 * What the admin browser measured of one preview step (G1). There is no layout route: the
 * browser measures and sends this as a fact, and the schema closes it to ids, enums and
 * bounded numbers.
 */
export const LayoutReportFact = z.strictObject({
  fact: z.literal("layout-report"),
  formId: FactFormId,
  stepId: FactStepId,
  device: PreviewDevice,
  viewport: Viewport,
  orientation: z.enum(["portrait", "landscape"]),
  zoomPercent: z.number().int().min(25).max(400),
  colorScheme: z.enum(["light", "dark"]),
  highContrast: z.boolean(),
  pageHeight: z.number().int().min(0).max(100_000),
  findings: z
    .array(z.strictObject({ questionId: FactQuestionId, issue: z.enum(LAYOUT_ISSUES) }))
    .max(50),
});

export type LayoutReportFact = z.infer<typeof LayoutReportFact>;

/** Both builder facts, which the field-vocabulary and sentinel walks cover. */
export const BUILDER_FACTS: readonly { readonly name: string; readonly schema: z.ZodType }[] = [
  { name: "fact preview-selection", schema: PreviewSelectionFact },
  { name: "fact layout-report", schema: LayoutReportFact },
];
