import { z } from "@hono/zod-openapi";
import { AnswerValue } from "@roonga/qcms-core";

/**
 * A malformed-request bound on an array the transport allocates before validation, not
 * an instance ceiling: what a batch may spend is the per-session answer allowance.
 */
export const MAX_BATCH_ANSWERS = 2000;

export const SessionParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "ses_9f3a2b1c" }),
});

/**
 * The navigation cursor changes only which document is drawn; it is never a validation
 * authority, and `flowState` stays the sole authority gating Continue and Submit.
 */
export const StepQuery = z.object({
  step: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .openapi({
      param: { name: "step", in: "query", required: false },
      description:
        "0-based index of the visible step to render (the explicit navigation cursor, ADR-28). Clamped to the visible range; omit to serve the first incomplete step.",
      example: 1,
    }),
});
export type StepQuery = z.infer<typeof StepQuery>;

/** `root` is opaque to the API, so `unknown` rather than a schema tracking the compiler. */
export const StepDocument = z
  .object({
    stepId: z.string().openapi({ example: "stp_history" }),
    root: z.unknown(),
  })
  .openapi("StepDocument");

/** Neither hidden questions nor the rule graph ever cross this boundary (SEC). */
export const FlowStateProjection = z
  .object({
    currentStep: z.string().nullable().openapi({ example: "stp_history" }),
    visibleQuestions: z.array(z.string()).openapi({
      description:
        "The currently-visible fields of the rendered step, as ANSWER KEYS: a bare questionId outside every repeating group, and `instanceId/questionId` inside one (ADR-42, ADR-43). A rule targeting inside a group is evaluated once per live instance, so a member question can be visible in one instance and hidden in another and only the qualified key can say which.",
      example: ["q_at_fault_accident", "q_accident_count"],
    }),
    missingRequired: z.array(z.string()).openapi({
      description:
        "The visible required fields still unanswered, as answer keys, on the same rule as visibleQuestions: one entry per unanswered (instance, question) inside a group rather than one per question.",
      example: ["q_accident_count"],
    }),
    readyToSubmit: z.boolean().openapi({
      description:
        "True when no visible required question is unanswered (the flow may be submitted).",
    }),
  })
  .openapi("FlowStateProjection");

/**
 * Already derived and truncated above the evaluator, so what crosses this boundary is
 * the list the renderer expands rather than anything it interprets.
 *
 * An instance id is opaque, random and session-scoped, carrying no respondent content
 * (SEC-16), and it is never a visible label.
 */
export const RosterProjection = z
  .array(
    z.object({
      groupId: z.string().openapi({ example: "grp_passengers" }),
      instances: z.array(z.string()).openapi({ example: ["ins_7k2", "ins_9m4"] }),
    }),
  )
  .openapi("RosterProjection");

export const StepProgress = z
  .object({
    stepIndex: z.number().int().openapi({
      description:
        "0-based index of the current step VIEW within the visible step views; equals totalVisibleSteps when complete.",
    }),
    totalVisibleSteps: z.number().int().openapi({ example: 1 }),
  })
  .openapi("StepProgress");

/**
 * A projection of what the server already decided rather than an input. Both keys are
 * null for every page a `perInstanceStep` group does not paginate.
 */
export const StepViewProjection = z
  .object({
    groupId: z.string().nullable().openapi({ example: "grp_vehicles" }),
    instanceId: z.string().nullable().openapi({ example: "ins_7k2" }),
  })
  .openapi("StepViewProjection");

/**
 * Scoped to the rendered step's visible questions, so an answer to a question the flow
 * hides never crosses this boundary (SEC); answer values are never logged (SEC-8).
 * Display data only: visibility and readiness stay in `flowState` (R2).
 *
 * `null` is outside the union deliberately, because a retraction is an ABSENT key
 * (ADR-33).
 *
 * `AnswerValue` is left inline rather than registered as a named component:
 * `zod-to-openapi` installs `.openapi()` on zod's prototypes and zod 4 copies those
 * methods onto each schema at construction, so a kernel schema built before
 * `@hono/zod-openapi` is evaluated never gains the method. The generator reads the
 * schema structurally, so the emitted document is unaffected.
 */
export const HeldValues = z.record(z.string(), AnswerValue).openapi({
  description:
    "The answers the server currently holds for this step's visible questions, keyed by questionId, in canonical AnswerValue encoding (an NFC string for shortText, longText, date and singleChoice; a finite number; a boolean; a duplicate-free array of optionIds for multiChoice). Absent keys are unanswered (including retracted answers), and a value is never null. Display data only; the flow projection stays the sole authority on visibility and readiness.",
  example: { q_at_fault_accident: true, q_accident_count: 2 },
});

export const StepResponse = z
  .object({
    step: StepDocument.nullable(),
    values: HeldValues,
    a2uiSpecVersion: z.string().openapi({
      description:
        "The pinned snapshot's A2UI spec version, so the renderer selects the right handling (ADR-18).",
      example: "1.0.0-preview.7",
    }),
    flowState: FlowStateProjection,
    rosters: RosterProjection,
    view: StepViewProjection,
    progress: StepProgress,
  })
  .openapi("StepResponse");
export type StepResponse = z.infer<typeof StepResponse>;

/**
 * `value` stays `unknown` here because the kernel validates it against the pinned
 * question version and its output is the canonical form the ledger stores.
 *
 * A literal `null` is the retraction (ADR-33) and is the only spelling of a clear: it is
 * not a legal `AnswerValue` for any question type, so it can never collide with real
 * content. `""` and `[]` are refused rather than reinterpreted as retractions.
 */
export const SubmitAnswerBody = z
  .strictObject({
    questionId: z.string().min(1).openapi({ example: "q_at_fault_accident" }),
    instanceId: z.string().min(1).optional().openapi({
      description:
        "Which instance of a repeating group this answer belongs to (ADR-42). Absent for a question outside every group, which keeps the body byte-identical for every form that has none. A retraction names an instance too, and clears that cell alone (ADR-33's Note).",
      example: "ins_7k2",
    }),
    value: z.unknown().openapi({
      description:
        'The answer value; validated against the pinned question. Literal null retracts the answer (the question becomes unanswered; the ledger records the retraction). An empty value ("" or []) is not an answer and is rejected with EMPTY_ANSWER_NOT_ALLOWED; send null to clear an answer.',
    }),
  })
  .openapi("SubmitAnswerBody");
export type SubmitAnswerBody = z.infer<typeof SubmitAnswerBody>;

/**
 * A Continue's answers only: the roster operation is its own post and commits none.
 *
 * Rate limited per entry rather than per request (SEC-16), so a batch of N answers
 * spends N units of the per-session answer allowance.
 */
export const BatchAnswerBody = z
  .strictObject({
    answers: z.array(SubmitAnswerBody).min(1).max(MAX_BATCH_ANSWERS).openapi({
      description:
        "The step's answers, in the order the form asked them. Each entry is exactly a single-answer body, including the null retraction and the optional instanceId.",
    }),
  })
  .openapi("BatchAnswerBody");
export type BatchAnswerBody = z.infer<typeof BatchAnswerBody>;

/**
 * A batch is not all-or-nothing on validation: a refused entry leaves the rest applied,
 * so one mistyped cell does not lose the others. The rate limit is all-or-nothing.
 */
export const BatchAnswerRejection = z
  .object({
    questionId: z.string(),
    instanceId: z.string().optional(),
    code: z.string().openapi({ example: "INVALID_ANSWER" }),
    details: z.unknown().optional(),
  })
  .openapi("BatchAnswerRejection");

export const BatchAnswerResponse = z
  .object({
    step: StepDocument.nullable(),
    values: HeldValues,
    a2uiSpecVersion: z.string(),
    flowState: FlowStateProjection,
    rosters: RosterProjection,
    view: StepViewProjection,
    progress: StepProgress,
    rejected: z.array(BatchAnswerRejection),
  })
  .openapi("BatchAnswerResponse");
export type BatchAnswerResponse = z.infer<typeof BatchAnswerResponse>;

/**
 * Commits no answers: the typed values ride the step POST and reach the ledger only on
 * Continue, which is what makes `formnovalidate` on Add and Remove safe.
 *
 * `opToken` is recorded with the roster row, so a replayed post applies nothing. It is
 * not a credential: refusing a replay within its own session is its only job.
 */
export const RosterOpBody = z
  .strictObject({
    op: z.enum(["add", "remove"]).openapi({ example: "add" }),
    groupId: z.string().min(1).openapi({ example: "grp_passengers" }),
    instanceId: z
      .string()
      .min(1)
      .optional()
      .openapi({ description: "Required for `remove`; refused for `add`.", example: "ins_7k2" }),
    opToken: z.string().min(1).max(128).openapi({
      description:
        "The one-time operation token this page minted. A token already applied is a no-op that returns the current roster.",
      example: "op_7f3a2b1c",
    }),
  })
  .openapi("RosterOpBody");
export type RosterOpBody = z.infer<typeof RosterOpBody>;

export const RosterOpResponse = z
  .object({
    step: StepDocument.nullable(),
    values: HeldValues,
    a2uiSpecVersion: z.string(),
    flowState: FlowStateProjection,
    rosters: RosterProjection,
    view: StepViewProjection,
    progress: StepProgress,
    replayed: z.boolean(),
    minted: z.array(z.string()),
  })
  .openapi("RosterOpResponse");
export type RosterOpResponse = z.infer<typeof RosterOpResponse>;
