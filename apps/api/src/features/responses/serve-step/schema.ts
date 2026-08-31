/**
 * Request/response schemas for the serving-loop slice (task 019): `GET
 * /sessions/{id}/step` and `POST /sessions/{id}/answers`.
 *
 * Zod is the single schema language (017's convention); these drive both
 * runtime validation of requests and the generated OpenAPI documents (027).
 *
 * The response is a deliberately **narrow projection** of the kernel's
 * `FlowState` (ADR-18, SEC): clients receive the current step's stored compiled
 * A2UI document, the answers already held for that step's visible questions, and
 * which of those questions are currently visible / still missing - never the full
 * rule graph, never the inventory of hidden questions, never an answer to a
 * question the flow hides. `step` is served verbatim from the pinned
 * `form_versions.compiled` JSONB, so it is modelled as an opaque document the
 * API does not re-shape (`root` is the A2UI node tree, passed through untouched),
 * and the held answers travel beside it rather than being written into it.
 */

import { z } from "@hono/zod-openapi";

/** Path params for the session-scoped serving routes. */
export const SessionParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "ses_9f3a2b1c" }),
});

/**
 * Optional query for the serving reads: the explicit navigation cursor (ADR-28).
 *
 * `step` is the 0-based index of the visible step the portal wants RENDERED. With
 * it, the handler serves exactly that visible step's stored document (clamped to
 * the visible range), so a step never collapses or advances as a side effect of
 * answering (findings M/N). Without it, the first incomplete step is served
 * (resume, no-JS, and the 019/029 callers - behaviour is unchanged). The cursor
 * changes only which document is drawn; it is NEVER a validation authority -
 * `flowState` (currentStep / readyToSubmit / missingRequired) stays the sole
 * authority the portal reads to gate Continue/Submit, and the portal performs no
 * rule evaluation of its own (R2).
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

/**
 * One stored compiled A2UI document (a `CompiledForm` document, task 011): the
 * step's id and its A2UI node tree. Served verbatim from the pinned snapshot -
 * `root` is opaque to the API (the renderer, 028, interprets it), so it is
 * `unknown` rather than a recursive schema the API would have to keep in step
 * with the compiler.
 */
export const StepDocument = z
  .object({
    stepId: z.string().openapi({ example: "stp_history" }),
    root: z.unknown(),
  })
  .openapi("StepDocument");

/**
 * The client-safe flow projection (SEC): only what the current step needs to
 * render its branching. `visibleQuestions` are the currently-visible questions
 * **of the current step** (a follow-up appears/disappears here as answers
 * change); `missingRequired` are the visible required questions still
 * unanswered. Neither hidden questions nor the rule graph are ever exposed.
 */
export const FlowStateProjection = z
  .object({
    currentStep: z.string().nullable().openapi({ example: "stp_history" }),
    visibleQuestions: z
      .array(z.string())
      .openapi({ example: ["q_at_fault_accident", "q_accident_count"] }),
    missingRequired: z.array(z.string()).openapi({ example: ["q_accident_count"] }),
    readyToSubmit: z.boolean().openapi({
      description:
        "True when no visible required question is unanswered (the flow may be submitted).",
    }),
  })
  .openapi("FlowStateProjection");

/** Where the respondent is in the visible flow (for a progress indicator). */
export const StepProgress = z
  .object({
    stepIndex: z.number().int().openapi({
      description:
        "0-based index of the current step within the visible steps; equals totalVisibleSteps when complete.",
    }),
    totalVisibleSteps: z.number().int().openapi({ example: 1 }),
  })
  .openapi("StepProgress");

/**
 * The answers the server already holds for the questions on the RENDERED step
 * (issue #146), keyed by questionId, in the canonical `AnswerValue` encoding the
 * ledger stores. A question with no current answer is simply absent, and a
 * question whose newest ledger row is an ADR-33 retraction is absent too
 * (`latestAnswers` resolves a tombstone to unanswered), so a retracted answer
 * comes back as unanswered rather than as a stale value.
 *
 * This is the separate path by which stored answers reach a client without
 * touching the compiled document (ADR-18): the served A2UI stays the immutable,
 * content-only bytes from the pinned snapshot, and the values ride beside it. It
 * is pure display data and never a decision: visibility stays in
 * `flowState.visibleQuestions` and readiness in `missingRequired` /
 * `readyToSubmit`, which the client reads and never re-derives (R2).
 *
 * Scoped to the rendered step's **visible** questions, which keeps the
 * hidden-flow property intact (SEC): an answer to a question the current flow
 * hides never crosses this boundary, so the client cannot learn that such a
 * question exists from the values map either. The values are the respondent's own
 * answers over their own session-authed request, and they are never logged
 * (SEC-8).
 */
export const HeldValues = z.record(z.string(), z.unknown()).openapi({
  description:
    "The answers the server currently holds for this step's visible questions, keyed by questionId, in canonical AnswerValue encoding. Absent keys are unanswered (including retracted answers). Display data only; the flow projection stays the sole authority on visibility and readiness.",
  example: { q_at_fault_accident: true, q_accident_count: 2 },
});

/**
 * The serving-loop response, returned by both the get-step read and the
 * submit-answer write (the portal re-renders branching from the write's
 * response, 029). When the flow is complete `step` is `null`,
 * `flowState.readyToSubmit` is `true`, and `flowState.missingRequired` is empty.
 */
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
    progress: StepProgress,
  })
  .openapi("StepResponse");
export type StepResponse = z.infer<typeof StepResponse>;

/**
 * Submit-answer request body. `value` is validated by the kernel
 * (`validateAnswer`, 009) against the pinned question version, so it is accepted
 * as `unknown` here and never re-shaped by the transport schema - the canonical
 * form the ledger stores is the kernel's output.
 *
 * A literal `null` is the **retraction** request (ADR-33): "the respondent
 * cleared this question". It is the one wire value that is not an answer, which
 * is why it can be spelled on this route without ambiguity - `null` is not a
 * legal `AnswerValue` for any question type, so it can never collide with real
 * content. The handler routes it to a tombstone append instead of validation.
 *
 * It is also the *only* spelling of a clear. `""` and `[]` are refused by the
 * kernel (`EMPTY_ANSWER_NOT_ALLOWED`, 422) rather than stored as answers or
 * quietly reinterpreted as retractions: nothing is appended, and the error names
 * `null` as what to send instead. Whitespace-only text is a different case - it
 * is a legal value, stored as typed, that simply confers no presence, so it
 * cannot satisfy a required question (issue #128).
 */
export const SubmitAnswerBody = z
  .object({
    questionId: z.string().min(1).openapi({ example: "q_at_fault_accident" }),
    value: z.unknown().openapi({
      description:
        "The answer value; validated against the pinned question. Literal null retracts the answer (the question becomes unanswered; the ledger records the retraction). An empty value (\"\" or []) is not an answer and is rejected with EMPTY_ANSWER_NOT_ALLOWED; send null to clear an answer.",
    }),
  })
  .openapi("SubmitAnswerBody");
export type SubmitAnswerBody = z.infer<typeof SubmitAnswerBody>;
