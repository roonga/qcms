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
import { AnswerValue } from "@roonga/qcms-core";

/**
 * The most answers one batch may carry.
 *
 * **Not an instance ceiling** (Q14 removed every installation-wide one): it is a
 * malformed-request bound on an array the transport has to allocate before anything
 * validates it, in the same spirit as the request-size limits already in force. The
 * real bound on a step's field count is the form's own `max` per group, enforced at
 * publish and on every add (SEC-16), and the real bound on what a batch may SPEND is
 * the per-session answer allowance it pays per entry.
 */
export const MAX_BATCH_ANSWERS = 2000;

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
 * The live instance roster per repeating group, in document order of the groups and
 * roster order within each (ADR-42, ADR-43).
 *
 * **Already derived and already truncated.** The `answer_group_instances` table
 * records what was minted and what was explicitly removed, and liveness is a function
 * of the count source: only an `open` group's live set is the event record itself,
 * while a `fixed` group's is the first `count` of it and a `fromAnswer` group's is the
 * first N for the current count answer, clamped. That derivation runs in the API above
 * the evaluator, so what crosses this boundary is the list the renderer expands and
 * nothing it has to interpret.
 *
 * **This is how the roster reaches the renderer, and it is deliberately not the
 * compiler's seam.** A compiled `RepeatGroup` is a template carrying its member
 * controls once: the compiler is pure and answer-blind and an instance count is
 * answer-dependent, so `StepResolverContext` is NOT widened (ADR-14 as amended
 * 2026-09-30) and the roster travels beside the document exactly as `values` do. The
 * portal still evaluates nothing (R2).
 *
 * An instance id is an opaque, random, session-scoped branded id carrying no
 * respondent content (SEC-16), and it is never a visible label: it appears in field
 * names, DOM ids, anchors and the no-JS fragment, and in no heading, legend, message
 * or caption. A count IS respondent-derived, which is why the redacted outbox payload
 * carries none (Q19) - but a respondent reading their own session over their own
 * session-authed request is not that boundary.
 */
export const RosterProjection = z
  .array(
    z.object({
      groupId: z.string().openapi({ example: "grp_passengers" }),
      instances: z.array(z.string()).openapi({ example: ["ins_7k2", "ins_9m4"] }),
    }),
  )
  .openapi("RosterProjection");

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
 *
 * **The value type is the kernel's own `AnswerValue` union, not `z.unknown()`
 * (issue #153).** The invariant above used to live only in this comment and in
 * the generated document's prose, which left the published contract saying "any
 * value, nullable" while the code guaranteed something far narrower. Reusing
 * `@roonga/qcms-core`'s schema rather than spelling a parallel one here is the point: one
 * definition of what an answer may be, the same one `validateAnswer` enforces
 * before a row reaches the ledger, so the document cannot drift from the storage.
 * `null` is outside the union deliberately - a retraction is an ABSENT key
 * (ADR-33), so a null value here would be a bug, and the schema refuses it now
 * instead of publishing it as legal.
 *
 * The union stays untagged, as the kernel leaves it: a date and a singleChoice
 * option are both strings, and pairing a value with its question type is
 * `validateAnswer`'s job, so the document says "one of the canonical encodings"
 * and no more.
 *
 * It is left INLINE rather than registered as a named `AnswerValue` component,
 * and that is a constraint rather than a preference. `zod-to-openapi` installs
 * `.openapi()` by extending zod's prototypes, and zod 4 copies those methods onto
 * each schema AT CONSTRUCTION, so a schema built before `@hono/zod-openapi` is
 * evaluated never gains the method. `@roonga/qcms-core`'s schemas are built whenever the
 * kernel module happens to load first, which under Vitest depends on the importing
 * test's import order - so `AnswerValue.openapi(...)` here is green in one entry
 * graph and a `TypeError` in another. Nothing about the emitted document depends
 * on it: the generator reads the schema structurally.
 */
export const HeldValues = z.record(z.string(), AnswerValue).openapi({
  description:
    "The answers the server currently holds for this step's visible questions, keyed by questionId, in canonical AnswerValue encoding (an NFC string for shortText, longText, date and singleChoice; a finite number; a boolean; a duplicate-free array of optionIds for multiChoice). Absent keys are unanswered (including retracted answers), and a value is never null. Display data only; the flow projection stays the sole authority on visibility and readiness.",
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
    rosters: RosterProjection,
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
 * The batch answer body (Q20, ADR-43): one Continue's answers, in one request.
 *
 * **Why it exists.** The no-JS path posts a **whole step**, and `forwardAnswers` made
 * one `POST /sessions/{id}/answers` per decoded answer, sequentially, each taking the
 * session's advisory lock and re-evaluating the flow. Nine passengers times six
 * questions is fifty-four round trips and fifty-four advisory locks for one Continue.
 * This carries them in one request, under one lock, with one flow evaluation.
 *
 * **It carries a Continue's answers only.** The roster operation is its own post and
 * commits no answers, so the earlier claim that the batch makes the two one
 * transaction does not hold and is withdrawn (ADR-43).
 *
 * **It is rate limited per ENTRY, not per request** (SEC-16). `answersPerSessionLimiter`
 * spends one unit per request, which is correct while one request carries one answer;
 * leaving it there would multiply a per-session allowance written for one answer by
 * the batch size, and with no installation-wide instance ceiling the batch size is the
 * author's `max`. So a batch of N answers spends N units of the same allowance, and a
 * batch that would exceed the remainder is refused rather than partially applied.
 *
 * `answers` is bounded here only against a malformed or hostile request; the real
 * bound is the form's own shape and the request-size limits already in force.
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
 * One refused entry of a batch: which field, and why.
 *
 * A batch is **not** all-or-nothing on validation, and that mirrors what the no-JS
 * route already did one call at a time: a 422 on one field fills that field's error
 * slot and the remaining answers still go, because a respondent who mistyped one cell
 * of nine passengers must not lose the other fifty-three. What IS all-or-nothing is
 * the rate limit: a batch that cannot be paid for in full is refused before any entry
 * is applied.
 */
export const BatchAnswerRejection = z
  .object({
    questionId: z.string(),
    instanceId: z.string().optional(),
    code: z.string().openapi({ example: "INVALID_ANSWER" }),
    details: z.unknown().optional(),
  })
  .openapi("BatchAnswerRejection");

/**
 * The batch response: the projection after the whole batch, plus the entries it
 * refused. The projection is the same `StepResponse` a single answer write returns, so
 * a caller reads `flowState` and `values` from it exactly as before.
 */
export const BatchAnswerResponse = z
  .object({
    step: StepDocument.nullable(),
    values: HeldValues,
    a2uiSpecVersion: z.string(),
    flowState: FlowStateProjection,
    rosters: RosterProjection,
    progress: StepProgress,
    rejected: z.array(BatchAnswerRejection),
  })
  .openapi("BatchAnswerResponse");
export type BatchAnswerResponse = z.infer<typeof BatchAnswerResponse>;

/**
 * The roster-operation body (ADR-43): the respondent's Add or Remove.
 *
 * **It commits no answers**, and that is the ruling of 2026-09-30 rather than an
 * omission: the typed values ride the step POST, are carried back for the re-render,
 * and reach the ledger only on Continue under the ordinary validation an ordinary
 * Continue does. That is what makes `formnovalidate` on the Add and Remove buttons
 * safe rather than merely convenient, and it is why `docs/portal-constraints.md`'s "a
 * required question cannot be cleared without scripting" bullet is unchanged.
 *
 * `opToken` is the **one-time operation token** the rendered page minted into the
 * button's value. It is recorded with the roster row, so a replayed post - a reload of
 * the 200 re-render, or a Back that resubmits - applies nothing and returns the roster
 * as it stands. It is not a credential: it is scoped to the session it was minted in
 * and refusing a replay is its only job.
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

/** The roster operation's response: the projection after it, and what it did. */
export const RosterOpResponse = z
  .object({
    step: StepDocument.nullable(),
    values: HeldValues,
    a2uiSpecVersion: z.string(),
    flowState: FlowStateProjection,
    rosters: RosterProjection,
    progress: StepProgress,
    /** True when the token had already been spent, so nothing was written. */
    replayed: z.boolean(),
    /** The instance this operation minted, when it minted one. */
    minted: z.array(z.string()),
  })
  .openapi("RosterOpResponse");
export type RosterOpResponse = z.infer<typeof RosterOpResponse>;
