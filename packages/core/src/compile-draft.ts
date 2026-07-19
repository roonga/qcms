import { err, ok } from "./errors.js";
import { SEMANTICS_VERSION } from "./evaluate-rules.js";
import type { FormDefinition } from "./form-definition.js";
import { isStepId, type QuestionId, type StepId } from "./ids.js";
import { isCompleteFor, type LocaleCode, type LocalizedText } from "./localized-text.js";
import type { FrozenSnapshot, PublishError, PublishResult } from "./publish-error.js";
import type { QuestionVersionRecord } from "./question-definition.js";
import { analyzeRuleGraph, checkRuleTypes, documentOrder, ruleReferences } from "./rule-graph.js";
import { CONDITION_MAX_DEPTH, conditionDepth } from "./visibility-rule.js";

/**
 * `compileDraft` — the publish aggregate (task 008, DOMAIN_SCHEMA §4.1,
 * ADR-01/02/14/16/18, invariants I1–I3, I10, R1).
 *
 * Publish is the single true aggregate: one atomic, pure call that either
 * returns an immutable deep-frozen snapshot or a complete typed error list —
 * **all** errors, never first-only, nothing persisted on failure (persistence
 * is not reachable from here; the API slice calls this in 022). The caller
 * supplies every lookup — core never does I/O (R3).
 *
 * Compiled A2UI and its version stamps are attached by the API slice using
 * 011's compiler; core does not import the compiler.
 */

/**
 * The structural version of the {@link FrozenSnapshot} shape itself, stamped
 * into every snapshot alongside {@link SEMANTICS_VERSION}. Increment when the
 * snapshot's *shape* changes (fields added/renamed/re-keyed) — stored
 * snapshots are immutable (R1), so readers use this stamp to interpret old
 * rows, never migrations.
 */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Resolve a `{questionId, version}` pin to the stored question version
 * (DOMAIN_SCHEMA §4.2). Return `undefined` when no such version exists — the
 * pin is reported as `DANGLING_QUESTION_REF`. Must be a pure lookup over
 * state the caller loaded up front: determinism is over
 * `(definition, resolved records, published set)`.
 */
export type ResolveQuestionVersion = (
  questionId: QuestionId,
  version: number,
) => QuestionVersionRecord | undefined;

/**
 * Everything publish needs, supplied by the caller (R3: slices load state,
 * pass it in, persist results — core never reaches for a database).
 */
export interface DraftInput {
  /** The parsed draft form (task 004's `FormDefinition`). */
  readonly definition: FormDefinition;
  /** Pin resolution over the caller's question store. */
  readonly resolveQuestion: ResolveQuestionVersion;
  /**
   * Which versions of each question are *published* (§4.2 lifecycle:
   * `QPublished`/`Referenced`, not `QDraft`/`Deprecated`-for-new-pins). A pin
   * that resolves but is absent here is `UNPUBLISHED_QUESTION_PIN` (R1: only
   * immutable content may be snapshotted). Enforcement of the lifecycle
   * itself (what may enter this set) is storage/authoring's job (013/021).
   */
  readonly publishedQuestionVersions: ReadonlyMap<QuestionId, ReadonlySet<number>>;
}

/** Recursively `Object.freeze` a plain-data tree (arrays included) in place. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/**
 * Re-checks of `FormDefinition`'s parse-level refinements, reported with
 * *structured domain paths* (not positional indices): `compileDraft` promises
 * a complete publish report even when handed a definition constructed without
 * `parseFormDefinition` (the type does not prove the refinements ran).
 */
function checkStructure(definition: FormDefinition): PublishError[] {
  const errors: PublishError[] = [];
  const seenSteps = new Set<StepId>();
  const seenQuestions = new Set<QuestionId>();
  for (const step of definition.steps) {
    if (seenSteps.has(step.stepId)) {
      errors.push({
        code: "DUPLICATE_STEP_ID",
        message: `Step "${step.stepId}" appears more than once in the form`,
        path: { step: step.stepId },
      });
    } else {
      seenSteps.add(step.stepId);
    }
    for (const item of step.items) {
      if (seenQuestions.has(item.questionId)) {
        errors.push({
          code: "DUPLICATE_QUESTION_IN_FORM",
          message: `Question "${item.questionId}" is pinned more than once (again in step "${step.stepId}")`,
          path: { step: step.stepId, question: item.questionId },
        });
      } else {
        seenQuestions.add(item.questionId);
      }
    }
  }
  for (const rule of definition.rules) {
    const depth = conditionDepth(rule.when);
    if (depth > CONDITION_MAX_DEPTH) {
      errors.push({
        code: "RULE_DEPTH_EXCEEDED",
        message: `Rule "${rule.ruleId}": condition nesting depth ${String(depth)} exceeds the cap of ${String(CONDITION_MAX_DEPTH)} (DOMAIN_SCHEMA §3)`,
        path: { rule: rule.ruleId },
      });
    }
  }
  return errors;
}

/**
 * Pin resolution (invariant I2 half one): every `QuestionRef` must resolve to
 * a stored version (`DANGLING_QUESTION_REF`) that is published
 * (`UNPUBLISHED_QUESTION_PIN`, R1). A record whose identity does not match
 * the requested pin is treated as unresolvable — a misbehaving lookup must
 * not smuggle the wrong content into an immutable snapshot.
 */
function resolvePins(
  draft: DraftInput,
  resolved: Map<QuestionId, QuestionVersionRecord>,
): PublishError[] {
  const errors: PublishError[] = [];
  for (const step of draft.definition.steps) {
    for (const item of step.items) {
      const record = draft.resolveQuestion(item.questionId, item.version);
      if (
        record === undefined ||
        record.questionId !== item.questionId ||
        record.version !== item.version
      ) {
        errors.push({
          code: "DANGLING_QUESTION_REF",
          message: `Step "${step.stepId}" pins question "${item.questionId}"@${String(item.version)}, which does not resolve to a stored question version`,
          path: { question: item.questionId, step: step.stepId },
        });
        continue;
      }
      if (draft.publishedQuestionVersions.get(item.questionId)?.has(item.version) !== true) {
        errors.push({
          code: "UNPUBLISHED_QUESTION_PIN",
          message: `Step "${step.stepId}" pins question "${item.questionId}"@${String(item.version)}, which is not a published question version (R1)`,
          path: { step: step.stepId, question: item.questionId, version: item.version },
        });
      }
      if (!resolved.has(item.questionId)) {
        resolved.set(item.questionId, record);
      }
    }
  }
  return errors;
}

/**
 * Rule reference/target resolution *within the form*: every questionId a
 * condition reads or a `show` entry targets must be pinned in the form, and
 * every step target must exist (`DANGLING_QUESTION_REF`/`DANGLING_STEP_REF`).
 * Option references are checked by `checkRuleTypes` against the pinned
 * version's declared options (`DANGLING_OPTION_REF`).
 */
function checkRuleResolution(definition: FormDefinition): PublishError[] {
  const errors: PublishError[] = [];
  const pinned = new Set<QuestionId>(documentOrder(definition).map((entry) => entry.questionId));
  const steps = new Set<StepId>(definition.steps.map((step) => step.stepId));
  for (const rule of definition.rules) {
    for (const questionId of ruleReferences(rule)) {
      if (!pinned.has(questionId)) {
        errors.push({
          code: "DANGLING_QUESTION_REF",
          message: `Rule "${rule.ruleId}" reads question "${questionId}", which is not pinned in the form`,
          path: { question: questionId, rule: rule.ruleId },
        });
      }
    }
    for (const target of rule.show) {
      if (isStepId(target)) {
        if (!steps.has(target)) {
          errors.push({
            code: "DANGLING_STEP_REF",
            message: `Rule "${rule.ruleId}" shows step "${target}", which is not in the form`,
            path: { rule: rule.ruleId, step: target },
          });
        }
      } else if (!pinned.has(target)) {
        errors.push({
          code: "DANGLING_QUESTION_REF",
          message: `Rule "${rule.ruleId}" shows question "${target}", which is not pinned in the form`,
          path: { question: target, rule: rule.ruleId },
        });
      }
    }
  }
  return errors;
}

/**
 * Default-locale completeness (invariant I3): every `LocalizedText` in the
 * form *and* in every pinned question version must carry the form's
 * `defaultLocale`. Only the default locale is checked at launch (ADR-11) —
 * other locales resolve through it.
 */
function checkLocaleCompleteness(
  definition: FormDefinition,
  resolved: ReadonlyMap<QuestionId, QuestionVersionRecord>,
): PublishError[] {
  const errors: PublishError[] = [];
  const locale: LocaleCode = definition.defaultLocale;
  const incomplete = (text: LocalizedText | undefined): boolean =>
    text !== undefined && !isCompleteFor(text, locale);

  if (incomplete(definition.title)) {
    errors.push({
      code: "LOCALE_INCOMPLETE",
      message: `Form title is missing the default locale "${locale}"`,
      path: { locale },
    });
  }
  for (const step of definition.steps) {
    if (incomplete(step.title)) {
      errors.push({
        code: "LOCALE_INCOMPLETE",
        message: `Step "${step.stepId}" title is missing the default locale "${locale}"`,
        path: { locale, step: step.stepId },
      });
    }
  }
  // Pinned question content, in document order (unresolved pins were already
  // reported as DANGLING_QUESTION_REF; there is nothing to check for them).
  for (const record of resolved.values()) {
    const question = record.definition;
    if (incomplete(question.label)) {
      errors.push({
        code: "LOCALE_INCOMPLETE",
        message: `Question "${question.questionId}" label is missing the default locale "${locale}"`,
        path: { locale, question: question.questionId },
      });
    }
    if (incomplete(question.help)) {
      errors.push({
        code: "LOCALE_INCOMPLETE",
        message: `Question "${question.questionId}" help text is missing the default locale "${locale}"`,
        path: { locale, question: question.questionId },
      });
    }
    if (question.type === "singleChoice" || question.type === "multiChoice") {
      for (const option of question.options) {
        if (incomplete(option.label)) {
          errors.push({
            code: "LOCALE_INCOMPLETE",
            message: `Option "${option.optionId}" of question "${question.questionId}" is missing the default locale "${locale}"`,
            path: { locale, question: question.questionId, option: option.optionId },
          });
        }
      }
    }
  }
  return errors;
}

/**
 * The atomic publish call (DOMAIN_SCHEMA §4.1): validate every publish
 * invariant, accumulating **all** errors; on success return the deep-frozen
 * `FrozenSnapshot` stamped with `{ semanticsVersion, schemaVersion }`.
 *
 * Checks, in report order:
 * 1. structural re-checks with domain paths (duplicate steps/pins, condition
 *    depth cap);
 * 2. pin resolution — every `QuestionRef` resolves to a *published* version
 *    (I2, R1);
 * 3. rule reference/target resolution within the form (I2);
 * 4. rule graph forward-only and acyclic (`analyzeRuleGraph`, ADR-16, I10);
 * 5. condition/operator type compatibility against the pinned versions,
 *    including option references (`checkRuleTypes`, ADR-21);
 * 6. default-locale completeness across form and pinned content (I3).
 *
 * The snapshot is a deep-frozen *clone* — the caller's draft stays mutable
 * (it is still a draft; only the snapshot is immutable, I1). Pure and
 * deterministic: the same draft and lookups produce a structurally identical
 * snapshot (I7 starts here).
 */
export function compileDraft(draft: DraftInput): PublishResult {
  const { definition } = draft;
  const resolved = new Map<QuestionId, QuestionVersionRecord>();

  const errors: PublishError[] = [
    ...checkStructure(definition),
    ...resolvePins(draft, resolved),
    ...checkRuleResolution(definition),
    ...analyzeRuleGraph(definition),
    ...checkRuleTypes(definition, (questionId) => resolved.get(questionId)?.definition),
    ...checkLocaleCompleteness(definition, resolved),
  ];
  if (errors.length > 0) {
    return err(errors);
  }

  // Every pin resolved (no errors), so the document-order sweep is total.
  const questions: QuestionVersionRecord[] = [];
  const seen = new Set<QuestionId>();
  for (const { questionId } of documentOrder(definition)) {
    const record = resolved.get(questionId);
    if (record !== undefined && !seen.has(questionId)) {
      seen.add(questionId);
      questions.push(record);
    }
  }

  const snapshot: FrozenSnapshot = deepFreeze(
    structuredClone({
      definition,
      questions,
      semanticsVersion: SEMANTICS_VERSION,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    }),
  );
  return ok(snapshot);
}
