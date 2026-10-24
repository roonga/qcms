import { z } from "zod";

import { AnswerValue, isBlankAnswerValue } from "./answer-value.js";
import { err, ok, type Result } from "./errors.js";
import {
  EvalError,
  evaluateRules,
  FlowState,
  type AnswerMap,
  type RosterMap,
} from "./evaluate-rules.js";
import { answerKey, answerKeyParts, GroupId, InstanceId, QuestionId } from "./ids.js";
import type { FrozenSnapshot } from "./publish-error.js";
import type { QuestionDefinition } from "./question-definition.js";
import { documentOrder } from "./rule-graph.js";
import { countBounds, repeatGroups } from "./step.js";
import { validateAnswer, ValidationError } from "./validate-answer.js";

/**
 * The submission lock (DOMAIN_SCHEMA §4.3, ADR-07, I6/I9): the audit boundary
 * that sweeps every visible required question for a valid answer, excludes a
 * hidden question's answer from the locked set, and seals the result under a
 * content hash.
 *
 * Pure over its inputs (R3) and fetch-pure (R4): hashing uses WebCrypto, which
 * is why the signature is async.
 *
 * `contentHash` is the lowercase-hex SHA-256 of the UTF-8 bytes of
 * `canonicalJson({ answers, flowState })`, the locked submission minus the hash
 * itself, so any holder can re-derive and verify it. Canonical JSON sorts
 * object keys at every depth and keeps array order, which is meaning here, so
 * equal submissions hash equally whatever the input key order.
 */

/** The closed contract the submit slice returns to the portal. */
export const SubmissionErrorCode = z.enum([
  "MISSING_REQUIRED",
  "INVALID_ANSWER",
  "UNKNOWN_QUESTION",
  "FLOW_EVALUATION_FAILED",
  // A submission error rather than a validation one: an instance count is a
  // property of the roster, and `validateAnswer` knows nothing about where a
  // question sits, which is what lets a table cell validate like any answer.
  "REPEAT_COUNT_OUT_OF_RANGE",
]);
export type SubmissionErrorCode = z.infer<typeof SubmissionErrorCode>;

const message = z.string().min(1);

/**
 * One submission failure. Reported complete rather than first-only, in document
 * order, then `UNKNOWN_QUESTION` entries sorted by questionId, since an unknown
 * id has no document position. Messages name ids only, never answer values
 * (SECURITY_DESIGN).
 */
export const SubmissionError = z.discriminatedUnion("code", [
  // One entry per `(instance, question)` inside a group, because a required
  // question is required in every live instance.
  z.object({
    code: z.literal("MISSING_REQUIRED"),
    message,
    questionId: QuestionId,
    instanceId: InstanceId.optional(),
  }),
  // `errors` carries the full per-constraint list for display.
  z.object({
    code: z.literal("INVALID_ANSWER"),
    message,
    questionId: QuestionId,
    instanceId: InstanceId.optional(),
    errors: z.array(ValidationError).min(1),
  }),
  // Defence against ledger drift.
  z.object({
    code: z.literal("UNKNOWN_QUESTION"),
    message,
    questionId: QuestionId,
    instanceId: InstanceId.optional(),
  }),
  z.object({
    code: z.literal("REPEAT_COUNT_OUT_OF_RANGE"),
    message,
    groupId: GroupId,
    count: z.number().int().min(0),
  }),
  // Unreachable on a published snapshot; returned rather than thrown so the
  // sweep stays total.
  z.object({ code: z.literal("FLOW_EVALUATION_FAILED"), message, cause: EvalError }),
]);
export type SubmissionError = z.infer<typeof SubmissionError>;

/** One locked answer. The `instanceId` key is absent rather than undefined
 * outside a group, which keeps a non-repeating form's `contentHash` stable. */
export const LockedAnswer = z.object({
  questionId: QuestionId,
  instanceId: InstanceId.optional(),
  value: AnswerValue,
});
export type LockedAnswer = z.infer<typeof LockedAnswer>;

/**
 * What submit locks (§4.3): the canonical answers of visible questions only
 * (I6), the flow state they were validated under, and the hash sealing both.
 */
export const LockedSubmission = z.object({
  answers: z.array(LockedAnswer),
  flowState: FlowState,
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type LockedSubmission = z.infer<typeof LockedSubmission>;

/**
 * Serialize plain JSON data with object keys sorted at every depth, which is
 * the canonical form `prepareSubmission` hashes. Arrays keep their order, and
 * `undefined` members are omitted as `JSON.stringify` omits them.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    // ECMAScript fully specifies primitive serialization, so this is
    // deterministic across platforms and runtime versions.
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
 * Lowercase-hex SHA-256 of `canonicalJson(content)` via WebCrypto (R4).
 * Exported so a caller can re-derive and verify a stored submission's hash.
 */
export async function computeContentHash(content: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(content));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate and lock a submission against a published snapshot (the I9 sweep).
 *
 * Having an answer means having a non-blank one, so an empty or whitespace-only
 * text value fails a required question and stays out of the locked set rather
 * than being sealed into the hash. A hidden question's answer is neither
 * validated nor locked (I6), so an orphaned answer never blocks submit.
 *
 * Errors are complete rather than first-only. No resolver is injected, because
 * the snapshot embeds its pinned definitions. Async only for WebCrypto.
 */
export async function prepareSubmission(
  snapshot: FrozenSnapshot,
  answers: AnswerMap,
  rosters?: RosterMap,
): Promise<Result<LockedSubmission, readonly SubmissionError[]>> {
  const definitions = new Map<QuestionId, QuestionDefinition>(
    snapshot.questions.map((record) => [record.questionId, record.definition]),
  );

  // Drift is judged on the question half of the key alone. An answer naming an
  // instance the roster no longer lists is a removed instance rather than
  // drift: it stays in the ledger and leaves the locked set like a hidden
  // question's answer (I6).
  const pinned = new Set(documentOrder(snapshot.definition).map((entry) => entry.questionId));
  const unknown = [...answers.keys()]
    .map((key) => answerKeyParts(key))
    .filter((parts) => !pinned.has(parts.questionId))
    .sort((left, right) => left.questionId.localeCompare(right.questionId));

  const evaluated = evaluateRules(
    snapshot,
    answers,
    (questionId) => definitions.get(questionId),
    rosters,
  );
  if (!evaluated.ok) {
    return err([
      {
        code: "FLOW_EVALUATION_FAILED",
        message: "Flow evaluation failed; the submission cannot be validated",
        cause: evaluated.error,
      },
      ...unknown.map((parts) => unknownQuestionError(parts.questionId, parts.instanceId)),
    ]);
  }
  const flowState = evaluated.value;

  const errors: SubmissionError[] = [];
  const locked: LockedAnswer[] = [];
  for (const { questionId, instanceId } of flowState.visible) {
    const definition = definitions.get(questionId);
    /* v8 ignore next 3 -- evaluateRules already failed UNRESOLVED_QUESTION_PIN
       for any pinned question the snapshot does not embed */
    if (definition === undefined) {
      continue;
    }
    // Presence rather than map membership: a blank answer holds nothing. The
    // sweep reads the same predicate the evaluator dropped the entry with, so
    // `flowState.missingRequired` and MISSING_REQUIRED cannot disagree.
    const answer = answers.get(answerKey(questionId, instanceId));
    const named = instanceId === undefined ? "" : ` in instance "${instanceId}"`;
    if (answer === undefined || isBlankAnswerValue(answer)) {
      if (definition.required) {
        errors.push({
          code: "MISSING_REQUIRED",
          message: `Required question "${questionId}"${named} has no answer`,
          questionId,
          ...(instanceId === undefined ? {} : { instanceId }),
        });
      }
      continue;
    }
    // `validateAnswer` is deliberately position-blind, so a cell inside a
    // table-presented group validates by the same call as a standalone
    // question. That is what makes a table a presentation rather than a type.
    const validated = validateAnswer(definition, answer);
    if (validated.ok) {
      locked.push({
        questionId,
        ...(instanceId === undefined ? {} : { instanceId }),
        value: validated.value,
      });
    } else {
      errors.push({
        code: "INVALID_ANSWER",
        message: `Answer for question "${questionId}"${named} is invalid`,
        questionId,
        ...(instanceId === undefined ? {} : { instanceId }),
        errors: [...validated.error],
      });
    }
  }
  errors.push(...checkRepeatCounts(snapshot, rosters));
  errors.push(...unknown.map((parts) => unknownQuestionError(parts.questionId, parts.instanceId)));

  if (errors.length > 0) {
    return err(errors);
  }

  const contentHash = await computeContentHash({ answers: locked, flowState });
  return ok({ answers: locked, flowState, contentHash });
}

/**
 * Every group's live instance count sits within the bounds its form declares.
 * The count comes from the caller's roster rather than from the answers,
 * because an instance with no answer at all is still live.
 */
function checkRepeatCounts(
  snapshot: FrozenSnapshot,
  rosters: RosterMap | undefined,
): SubmissionError[] {
  const errors: SubmissionError[] = [];
  for (const group of repeatGroups(snapshot.definition.steps)) {
    const count = rosters?.get(group.groupId)?.length ?? 0;
    const bounds = countBounds(group.count);
    if (count < bounds.min || (bounds.max !== undefined && count > bounds.max)) {
      const ceiling = bounds.max === undefined ? "no declared max" : `max ${String(bounds.max)}`;
      errors.push({
        code: "REPEAT_COUNT_OUT_OF_RANGE",
        message: `Group "${group.groupId}" has ${String(count)} live instances, outside its declared min ${String(bounds.min)} and ${ceiling}`,
        groupId: group.groupId,
        count,
      });
    }
  }
  return errors;
}

function unknownQuestionError(
  questionId: QuestionId,
  instanceId: InstanceId | undefined,
): SubmissionError {
  return {
    code: "UNKNOWN_QUESTION",
    message: `Answer references question "${questionId}", which is not in the form`,
    questionId,
    ...(instanceId === undefined ? {} : { instanceId }),
  };
}
