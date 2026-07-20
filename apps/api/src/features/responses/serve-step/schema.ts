/**
 * Request/response schemas for the serving-loop slice (task 019): `GET
 * /sessions/{id}/step` and `POST /sessions/{id}/answers`.
 *
 * Zod is the single schema language (017's convention); these drive both
 * runtime validation of requests and the generated OpenAPI documents (027).
 *
 * The response is a deliberately **narrow projection** of the kernel's
 * `FlowState` (ADR-18, SEC): clients receive the current step's stored compiled
 * A2UI document plus which of that step's questions are currently visible and
 * which required ones are still missing — never the full rule graph, never the
 * inventory of hidden questions. `step` is served verbatim from the pinned
 * `form_versions.compiled` JSONB, so it is modelled as an opaque document the
 * API does not re-shape (`root` is the A2UI node tree, passed through untouched).
 */

import { z } from "@hono/zod-openapi";

/** Path params for the session-scoped serving routes. */
export const SessionParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "ses_9f3a2b1c" }),
});

/**
 * One stored compiled A2UI document (a `CompiledForm` document, task 011): the
 * step's id and its A2UI node tree. Served verbatim from the pinned snapshot —
 * `root` is opaque to the API (the renderer, 028, interprets it), so it is
 * `unknown` rather than a recursive schema the API would have to keep in step
 * with the compiler.
 */
export const StepDocument = z
  .object({
    stepId: z.string().openapi({ example: "stp_health" }),
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
    currentStep: z.string().nullable().openapi({ example: "stp_health" }),
    visibleQuestions: z.array(z.string()).openapi({ example: ["q_smoker", "q_cigs_daily"] }),
    missingRequired: z.array(z.string()).openapi({ example: ["q_cigs_daily"] }),
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
 * The serving-loop response, returned by both the get-step read and the
 * submit-answer write (the portal re-renders branching from the write's
 * response, 029). When the flow is complete `step` is `null`,
 * `flowState.readyToSubmit` is `true`, and `flowState.missingRequired` is empty.
 */
export const StepResponse = z
  .object({
    step: StepDocument.nullable(),
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
 * as `unknown` here and never re-shaped by the transport schema — the canonical
 * form the ledger stores is the kernel's output.
 */
export const SubmitAnswerBody = z
  .object({
    questionId: z.string().min(1).openapi({ example: "q_smoker" }),
    value: z
      .unknown()
      .openapi({ description: "The answer value; validated against the pinned question." }),
  })
  .openapi("SubmitAnswerBody");
export type SubmitAnswerBody = z.infer<typeof SubmitAnswerBody>;
