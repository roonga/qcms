import { z } from "zod";

import { AnswerValue } from "./answer-value.js";
import { err, ok, type Result } from "./errors.js";
import { EvalError, evaluateRules, FlowState, type AnswerMap } from "./evaluate-rules.js";
import { QuestionId } from "./ids.js";
import type { FrozenSnapshot } from "./publish-error.js";
import type { QuestionDefinition } from "./question-definition.js";
import { documentOrder } from "./rule-graph.js";
import { validateAnswer, ValidationError } from "./validate-answer.js";

/**
 * The submission lock (task 009, DOMAIN_SCHEMA §4.3, ADR-07, invariants
 * I6/I9). `prepareSubmission` is the audit boundary: it evaluates the flow
 * (task 006), sweeps every **visible required** question for a valid answer
 * (I9), excludes hidden questions' answers from the locked set (I6 - they
 * remain in the append-only ledger, never in the submission), and seals the
 * result under a content hash.
 *
 * Pure over its inputs (R3 - the caller loads the snapshot and the
 * latest-per-question answers) and fetch-pure (R4 - hashing uses WebCrypto
 * `crypto.subtle`, hence the async signature; no Node-only APIs).
 *
 * ## contentHash canonicalization (the documented contract)
 *
 * `contentHash` is the lowercase-hex SHA-256 of the UTF-8 bytes of
 * `canonicalJson({ answers, flowState })` - the LockedSubmission minus the
 * hash itself, so any holder can re-derive and verify it. `canonicalJson` is
 * JSON with one degree of freedom removed:
 *
 * - object keys are serialized in lexicographic (code-unit) order, at every
 *   depth; keys whose value is `undefined` are omitted (as in JSON.stringify);
 * - arrays keep their order (order is meaning: `answers` is document order,
 *   multiChoice selections are canonical first-occurrence order);
 * - strings/numbers/booleans/null serialize exactly as `JSON.stringify` -
 *   deterministic across platforms and Node versions because ECMAScript fully
 *   specifies Number::toString (shortest round-trip form) and string escaping;
 * - no whitespace.
 *
 * Answer values inside are canonical encodings (§2.4: NFC-normalized text,
 * deduplicated multiChoice), so equal submissions hash equally regardless of
 * input key order or non-canonical spellings.
 */

/** Codes for the submission sweep - the closed contract the submit slice
 * (020) returns to the portal. */
export const SubmissionErrorCode = z.enum([
  "MISSING_REQUIRED",
  "INVALID_ANSWER",
  "UNKNOWN_QUESTION",
  "FLOW_EVALUATION_FAILED",
]);
export type SubmissionErrorCode = z.infer<typeof SubmissionErrorCode>;

const message = z.string().min(1);

/**
 * One submission failure. Reported complete (all errors, never first-only),
 * in document order for visible questions, then `UNKNOWN_QUESTION` entries
 * sorted by questionId (unknown ids have no document position). Messages name
 * ids only - never answer values (SECURITY_DESIGN).
 */
export const SubmissionError = z.discriminatedUnion("code", [
  // A visible required question with no answer (I9).
  z.object({ code: z.literal("MISSING_REQUIRED"), message, questionId: QuestionId }),
  // A visible question's present answer failed validateAnswer; `errors`
  // carries the full per-constraint list for UI display.
  z.object({
    code: z.literal("INVALID_ANSWER"),
    message,
    questionId: QuestionId,
    errors: z.array(ValidationError).min(1),
  }),
  // An answer for a questionId not pinned in the form at all - defense
  // against ledger drift.
  z.object({ code: z.literal("UNKNOWN_QUESTION"), message, questionId: QuestionId }),
  // The flow evaluation itself failed (unreachable on a compileDraft
  // snapshot with I5-resolved answers; returned, never thrown, for totality).
  z.object({ code: z.literal("FLOW_EVALUATION_FAILED"), message, cause: EvalError }),
]);
export type SubmissionError = z.infer<typeof SubmissionError>;

/** One locked answer: a visible question's canonical value. */
export const LockedAnswer = z.object({
  questionId: QuestionId,
  value: AnswerValue,
});
export type LockedAnswer = z.infer<typeof LockedAnswer>;

/**
 * What submit locks (§4.3): the canonical answer set in document order -
 * visible questions only (I6), values in canonical encoding - the flow state
 * it was validated under, and the content hash sealing both (canonicalization
 * documented in the module doc above).
 */
export const LockedSubmission = z.object({
  answers: z.array(LockedAnswer),
  flowState: FlowState,
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type LockedSubmission = z.infer<typeof LockedSubmission>;

/**
 * Serialize plain JSON data with lexicographically sorted object keys at
 * every depth (arrays keep their order; `undefined` members are omitted,
 * matching JSON.stringify). The canonical form hashed by `prepareSubmission`.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    // Primitives: exactly JSON.stringify (deterministic per ECMAScript spec).
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalJson(item === undefined ? null : item));
    return `[${items.join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(",")}}`;
}

/**
 * Lowercase-hex SHA-256 of `canonicalJson(content)` via WebCrypto
 * `crypto.subtle` (fetch-pure, R4). Exported so later slices (013/020) can
 * re-derive and verify a stored submission's hash.
 */
export async function computeContentHash(content: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(content));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate and lock a submission against a published snapshot (the I9 sweep):
 *
 * 1. Answer keys not pinned in the form → `UNKNOWN_QUESTION`.
 * 2. Evaluate the flow (task 006) over the answers.
 * 3. Every visible required question must have an answer
 *    (`MISSING_REQUIRED`); every present answer for a *visible* question is
 *    re-validated with `validateAnswer` (`INVALID_ANSWER`).
 * 4. Hidden questions' answers are excluded from the locked set (I6) -
 *    they are not validated either; an orphaned answer never blocks submit.
 *
 * Errors are complete (all of them, never first-only). On success the
 * `LockedSubmission` carries the canonical ordered answers, the flow state,
 * and the content hash (see module doc for the canonicalization).
 *
 * The snapshot is self-contained (`FrozenSnapshot.questions` embeds the
 * pinned definitions, task 008), so no resolver is injected here. Async only
 * for WebCrypto; everything else is pure and deterministic.
 */
export async function prepareSubmission(
  snapshot: FrozenSnapshot,
  answers: AnswerMap,
): Promise<Result<LockedSubmission, readonly SubmissionError[]>> {
  const definitions = new Map<QuestionId, QuestionDefinition>(
    snapshot.questions.map((record) => [record.questionId, record.definition]),
  );

  const pinned = new Set(documentOrder(snapshot.definition).map((entry) => entry.questionId));
  const unknown = [...answers.keys()].filter((questionId) => !pinned.has(questionId)).sort();

  const evaluated = evaluateRules(snapshot, answers, (questionId) => definitions.get(questionId));
  if (!evaluated.ok) {
    return err([
      {
        code: "FLOW_EVALUATION_FAILED",
        message: "Flow evaluation failed; the submission cannot be validated",
        cause: evaluated.error,
      },
      ...unknown.map((questionId) => unknownQuestionError(questionId)),
    ]);
  }
  const flowState = evaluated.value;

  const errors: SubmissionError[] = [];
  const locked: LockedAnswer[] = [];
  for (const { questionId } of flowState.visible) {
    const definition = definitions.get(questionId);
    /* v8 ignore next 3 -- evaluateRules already failed UNRESOLVED_QUESTION_PIN
       for any pinned question the snapshot does not embed */
    if (definition === undefined) {
      continue;
    }
    if (!answers.has(questionId)) {
      if (definition.required) {
        errors.push({
          code: "MISSING_REQUIRED",
          message: `Required question "${questionId}" has no answer`,
          questionId,
        });
      }
      continue;
    }
    const validated = validateAnswer(definition, answers.get(questionId));
    if (validated.ok) {
      locked.push({ questionId, value: validated.value });
    } else {
      errors.push({
        code: "INVALID_ANSWER",
        message: `Answer for question "${questionId}" is invalid`,
        questionId,
        errors: [...validated.error],
      });
    }
  }
  errors.push(...unknown.map((questionId) => unknownQuestionError(questionId)));

  if (errors.length > 0) {
    return err(errors);
  }

  const contentHash = await computeContentHash({ answers: locked, flowState });
  return ok({ answers: locked, flowState, contentHash });
}

function unknownQuestionError(questionId: QuestionId): SubmissionError {
  return {
    code: "UNKNOWN_QUESTION",
    message: `Answer references question "${questionId}", which is not in the form`,
    questionId,
  };
}
