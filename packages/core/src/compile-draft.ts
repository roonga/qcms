import { err, ok } from "./errors.js";
import { SEMANTICS_VERSION } from "./evaluate-rules.js";
import type { FormDefinition } from "./form-definition.js";
import { isStepId, type OptionId, type QuestionId, type StepId } from "./ids.js";
import { isCompleteFor, type LocaleCode, type LocalizedText } from "./localized-text.js";
import type { FrozenSnapshot, PublishError, PublishResult } from "./publish-error.js";
import type { PublishWarning } from "./publish-warning.js";
import {
  authoredMessageKeys,
  type QuestionDefinition,
  type QuestionVersionRecord,
} from "./question-definition.js";
import { analyzeRuleGraph, checkRuleTypes, documentOrder, ruleReferences } from "./rule-graph.js";
import { classSetAmbiguity } from "./safe-pattern.js";
import { VALIDATION_MESSAGE_KEYS } from "./validation-message.js";
import { CONDITION_MAX_DEPTH, conditionDepth } from "./visibility-rule.js";

/**
 * `compileDraft` - the publish aggregate (task 008, DOMAIN_SCHEMA §4.1,
 * ADR-01/02/14/16/18, invariants I1–I3, I10, R1).
 *
 * Publish is the single true aggregate: one atomic, pure call that either
 * returns an immutable deep-frozen snapshot or a complete typed error list -
 * **all** errors, never first-only, nothing persisted on failure (persistence
 * is not reachable from here; the API slice calls this in 022). The caller
 * supplies every lookup - core never does I/O (R3).
 *
 * Compiled A2UI and its version stamps are attached by the API slice using
 * 011's compiler; core does not import the compiler.
 */

/**
 * The structural version of the {@link FrozenSnapshot} shape itself, stamped
 * into every snapshot alongside {@link SEMANTICS_VERSION}. Increment when the
 * snapshot's *shape* changes (fields added/renamed/re-keyed) - stored
 * snapshots are immutable (R1), so readers use this stamp to interpret old
 * rows, never migrations.
 */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Resolve a `{questionId, version}` pin to the stored question version
 * (DOMAIN_SCHEMA §4.2). Return `undefined` when no such version exists - the
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
 * pass it in, persist results - core never reaches for a database).
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
  // eslint-disable-next-line sonarjs/different-types-comparison -- typeof null === "object", explicit null guard required
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
 * the requested pin is treated as unresolvable - a misbehaving lookup must
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
 * One authored `LocalizedText` in the draft, with the sentence subject that
 * names it and the structured path that locates it.
 *
 * Enumerated once and consumed by both text checks: default-locale
 * completeness (I3) and the blank-value check (issue #366). Two verdicts about
 * the same value, so walking the draft twice to reach them would be two
 * traversals that must be kept in step by hand.
 */
interface TextSite {
  readonly text: LocalizedText;
  /** How the report names this text, e.g. `Question "q_dob" label`. */
  readonly subject: string;
  readonly path: {
    readonly step?: StepId;
    readonly question?: QuestionId;
    readonly option?: OptionId;
  };
}

/**
 * Every authored text on one pinned question version: label, help, the ADR-32
 * validation messages, the ADR-36 boolean labels and choice-option labels.
 * Each of these is resolved at compile time by a resolver that *throws* on a
 * missing default locale, so a gap has to be a publish error rather than a
 * compiler crash later.
 */
function questionTextSites(question: QuestionDefinition): TextSite[] {
  const sites: TextSite[] = [];
  const path = { question: question.questionId };
  const at = (text: LocalizedText | undefined, field: string): void => {
    if (text !== undefined) {
      sites.push({ text, subject: `Question "${question.questionId}" ${field}`, path });
    }
  };
  at(question.label, "label");
  at(question.help, "help text");
  for (const key of VALIDATION_MESSAGE_KEYS) {
    at(question.messages?.[key], `validation message "${key}"`);
  }
  if (question.type === "boolean") {
    at(question.yesLabel, "yesLabel");
    at(question.noLabel, "noLabel");
  }
  if (question.type === "singleChoice" || question.type === "multiChoice") {
    for (const option of question.options) {
      sites.push({
        text: option.label,
        subject: `Option "${option.optionId}" of question "${question.questionId}"`,
        path: { question: question.questionId, option: option.optionId },
      });
    }
  }
  return sites;
}

/**
 * Every authored text in the form and in its pinned question versions, in
 * report order: the form title, then step titles, then pinned question content
 * in document order.
 */
function textSites(
  definition: FormDefinition,
  resolved: ReadonlyMap<QuestionId, QuestionVersionRecord>,
): TextSite[] {
  const sites: TextSite[] = [];
  if (definition.title !== undefined) {
    sites.push({ text: definition.title, subject: "Form title", path: {} });
  }
  for (const step of definition.steps) {
    if (step.title !== undefined) {
      sites.push({
        text: step.title,
        subject: `Step "${step.stepId}" title`,
        path: { step: step.stepId },
      });
    }
  }
  // Pinned question content (unresolved pins were already reported as
  // DANGLING_QUESTION_REF; there is nothing to check for them).
  for (const record of resolved.values()) {
    sites.push(...questionTextSites(record.definition));
  }
  return sites;
}

/**
 * ADR-31 advisory (issue #123): a rule whose condition reads a **multiChoice**
 * answer and whose target is a question on the **same step**.
 *
 * ADR-31 classifies multiChoice as committing on *group exit* rather than on
 * change, so a reveal aimed at the same step cannot happen while the
 * respondent is still inside the checkbox group: it lands later than the
 * author almost certainly drew it. The draft is legal and the snapshot is
 * correct, which is exactly why this is a warning and not an error.
 *
 * A **cross-step** target does not warn, and that is the point of the
 * classification rather than an omission: the respondent leaves the group by
 * advancing, so the commit and the reveal happen in the right order. Nor does
 * a rule reading any other question type, whose answers commit on change.
 */
function checkMultiChoiceSameStepTargets(
  definition: FormDefinition,
  resolved: ReadonlyMap<QuestionId, QuestionVersionRecord>,
): PublishWarning[] {
  const stepOf = new Map<QuestionId, StepId>();
  for (const { stepId, questionId } of documentOrder(definition)) {
    if (!stepOf.has(questionId)) stepOf.set(questionId, stepId);
  }

  const warnings: PublishWarning[] = [];
  for (const rule of definition.rules) {
    for (const questionId of ruleReferences(rule)) {
      if (resolved.get(questionId)?.definition.type !== "multiChoice") continue;
      const step = stepOf.get(questionId);
      if (step === undefined) continue;
      for (const target of rule.show) {
        if (isStepId(target) || stepOf.get(target) !== step) continue;
        warnings.push({
          code: "MULTICHOICE_SAME_STEP_TARGET",
          message: `Rule "${rule.ruleId}" reads multiChoice question "${questionId}" and shows question "${target}" on the same step "${step}". A multiChoice answer commits on group exit (ADR-31), so the reveal cannot happen while the respondent is still inside the checkbox group; a target on a later step reveals when they advance.`,
          path: { rule: rule.ruleId, question: questionId, target, step },
        });
      }
    }
  }
  return warnings;
}

/**
 * Pattern class-set advisory (issue #53): a shortText `pattern` whose
 * character class carries an unescaped `&&` or `--`.
 *
 * These compile under both regex flags and mean different things under each,
 * with no console error and no compile failure anywhere downstream, so the
 * authoring gate is the only layer that can say so. See `classSetAmbiguity`.
 */
function checkPatternAmbiguity(
  resolved: ReadonlyMap<QuestionId, QuestionVersionRecord>,
): PublishWarning[] {
  const warnings: PublishWarning[] = [];
  for (const record of resolved.values()) {
    const question = record.definition;
    if (question.type !== "shortText") continue;
    const { pattern } = question.constraints;
    if (pattern === undefined) continue;
    const operator = classSetAmbiguity(pattern);
    if (operator === undefined) continue;
    warnings.push({
      code: "PATTERN_CLASS_SET_AMBIGUOUS",
      message: `Question "${question.questionId}" has a pattern whose character class contains an unescaped "${operator}". A browser reads it as a class-set operator (the 'v' flag) and this kernel reads it as two plain characters (the 'u' flag), so the same pattern accepts different answers in the two places. If the operator was not intended, rewrite the class so the two characters cannot be read as one.`,
      path: { question: question.questionId },
    });
  }
  return warnings;
}

/**
 * Author-supplied validation messages decorate a constraint the question
 * actually carries (ADR-32). A message keyed by a constraint the question does
 * not carry can never be shown to a respondent, so it is an authoring mistake
 * rather than harmless dead content: publish reports it as
 * `ORPHAN_MESSAGE_KEY`, in canonical key order.
 */
function checkAuthoredMessages(
  resolved: ReadonlyMap<QuestionId, QuestionVersionRecord>,
): PublishError[] {
  const errors: PublishError[] = [];
  for (const record of resolved.values()) {
    const question = record.definition;
    const { messages } = question;
    if (messages === undefined) continue;
    const carried = new Set(authoredMessageKeys(question));
    for (const key of VALIDATION_MESSAGE_KEYS) {
      if (messages[key] !== undefined && !carried.has(key)) {
        errors.push({
          code: "ORPHAN_MESSAGE_KEY",
          message: `Question "${question.questionId}" supplies a validation message for "${key}", which this question does not carry`,
          path: { question: question.questionId, constraint: key },
        });
      }
    }
  }
  return errors;
}

/**
 * Default-locale completeness (invariant I3): every `LocalizedText` in the
 * form *and* in every pinned question version must carry the form's
 * `defaultLocale`. Only the default locale is checked at launch (ADR-11) -
 * other locales resolve through it.
 */
function checkLocaleCompleteness(definition: FormDefinition, sites: readonly TextSite[]) {
  const locale: LocaleCode = definition.defaultLocale;
  const errors: PublishError[] = [];
  for (const site of sites) {
    if (!isCompleteFor(site.text, locale)) {
      errors.push({
        code: "LOCALE_INCOMPLETE",
        message: `${site.subject} is missing the default locale "${locale}"`,
        path: { locale, ...site.path },
      });
    }
  }
  return errors;
}

/**
 * No authored text is whitespace only (issue #366).
 *
 * `LocalizedText` is `z.string().min(1)` and stays that way: published
 * snapshots are re-parsed on the serving path, so tightening the schema to
 * `.trim().min(1)` would make an already-published form containing a blank
 * label fail to parse at serve time - a regression in R1, the one guarantee
 * the project treats as non-negotiable, traded for a rule the authoring gate
 * can express just as well. So the rule lives here, beside the locale
 * completeness it is a sibling of: reject what can be authored next, leave
 * what is already stored serving.
 *
 * The admin trims at its own boundary (`trimLocalized`), which is why this was
 * latent rather than live. That makes this the backstop for every *other*
 * writer - an import path, a direct authoring-API call - rather than a
 * replacement for that trimming.
 *
 * Every locale is checked, not only the default: a blank translation reaches a
 * respondent as a nameless control exactly as a blank default label does, and
 * the report names the locale so the author knows which one.
 */
function checkBlankText(sites: readonly TextSite[]): PublishError[] {
  const errors: PublishError[] = [];
  for (const site of sites) {
    for (const [locale, value] of Object.entries(site.text)) {
      if (value !== undefined && value.trim() === "") {
        errors.push({
          code: "BLANK_LOCALIZED_TEXT",
          message: `${site.subject} is blank in locale "${locale}": a whitespace-only value would reach a respondent as no text at all`,
          // The key of a parsed LocalizedText is a LocaleCode by construction.
          path: { locale: locale as LocaleCode, ...site.path },
        });
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
 * 2. pin resolution - every `QuestionRef` resolves to a *published* version
 *    (I2, R1);
 * 3. rule reference/target resolution within the form (I2);
 * 4. rule graph forward-only and acyclic (`analyzeRuleGraph`, ADR-16, I10);
 * 5. condition/operator type compatibility against the pinned versions,
 *    including option references (`checkRuleTypes`, ADR-21);
 * 6. default-locale completeness across form and pinned content (I3), and no
 *    authored text that is whitespace only (issue #366);
 * 7. author-supplied validation messages key only constraints the pinned
 *    question carries (ADR-32).
 *
 * A clean draft then collects **warnings** (issue #123): advisories about a
 * form that publishes correctly but probably does not behave as its author
 * drew it. They never refuse a publish; they ride the success result beside
 * the snapshot.
 *
 * The snapshot is a deep-frozen *clone* - the caller's draft stays mutable
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
  ];
  const sites = textSites(definition, resolved);
  errors.push(...checkLocaleCompleteness(definition, sites));
  errors.push(...checkBlankText(sites));
  errors.push(...checkAuthoredMessages(resolved));
  if (errors.length > 0) {
    return err(errors);
  }

  // Advisories, computed only once the draft is publishable. A warning
  // describes a snapshot that exists, so there is nothing to advise about a
  // draft that produced none, and a report mixing "this is why you cannot
  // publish" with "this will publish but read oddly" would blur the one
  // distinction the two channels exist to keep.
  const warnings: PublishWarning[] = [
    ...checkMultiChoiceSameStepTargets(definition, resolved),
    ...checkPatternAmbiguity(resolved),
  ];

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
  return ok({ snapshot, warnings });
}
