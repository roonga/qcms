import { err, ok } from "./errors.js";
import { SEMANTICS_VERSION } from "./evaluate-rules.js";
import type { FormDefinition } from "./form-definition.js";
import { isStepId, type GroupId, type OptionId, type QuestionId, type StepId } from "./ids.js";
import { isCompleteFor, type LocaleCode, type LocalizedText } from "./localized-text.js";
import type { FrozenSnapshot, PublishError, PublishResult } from "./publish-error.js";
import type { PublishWarning } from "./publish-warning.js";
import {
  authoredMessageKeys,
  type QuestionDefinition,
  type QuestionVersionRecord,
} from "./question-definition.js";
import {
  analyzeRuleGraph,
  checkRuleTypes,
  documentOrder,
  ruleGroupReferences,
  ruleReferences,
} from "./rule-graph.js";
import {
  countBounds,
  INSTANCE_LABEL_PLACEHOLDER,
  isRepeatGroup,
  isTableColumnType,
  labelPlaceholders,
  repeatGroups,
  TABLE_COLUMN_TYPES,
  type RepeatGroup,
} from "./step.js";
import { classSetAmbiguity } from "./safe-pattern.js";
import { VALIDATION_MESSAGE_KEYS } from "./validation-message.js";
import { CONDITION_MAX_DEPTH, conditionDepth } from "./visibility-rule.js";

/**
 * The publish aggregate (DOMAIN_SCHEMA §4.1, I1-I3, I10, R1): one atomic, pure
 * call returning either a deep-frozen snapshot or every typed error at once.
 * The caller supplies every lookup, because core does no I/O (R3).
 */

/**
 * The structural version of the {@link FrozenSnapshot} shape, stamped into
 * every snapshot. Increment it when the shape changes: stored snapshots are
 * immutable (R1), so readers interpret old rows by this stamp, never by
 * migration.
 */
export const SNAPSHOT_SCHEMA_VERSION = 2;

/**
 * Resolve a `{questionId, version}` pin to the stored question version, or
 * `undefined` when none exists. Must be a pure lookup over state the caller
 * loaded up front, so that publish stays deterministic.
 */
export type ResolveQuestionVersion = (
  questionId: QuestionId,
  version: number,
) => QuestionVersionRecord | undefined;

/** Everything publish needs, supplied by the caller (R3). */
export interface DraftInput {
  readonly definition: FormDefinition;
  /** Pin resolution over the caller's question store. */
  readonly resolveQuestion: ResolveQuestionVersion;
  /**
   * Which versions of each question are published. A pin that resolves but is
   * absent here is `UNPUBLISHED_QUESTION_PIN`: only immutable content may be
   * snapshotted (R1). Enforcing the lifecycle itself is storage's job.
   */
  readonly publishedQuestionVersions: ReadonlyMap<QuestionId, ReadonlySet<number>>;
}

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
 * Re-checks `FormDefinition`'s parse-level refinements with structured domain
 * paths, because the type does not prove the refinements ran and the publish
 * report must be complete even for a hand-constructed definition.
 */
function checkStructure(definition: FormDefinition): PublishError[] {
  const errors: PublishError[] = [];
  const seenSteps = new Set<StepId>();
  const seenQuestions = new Set<QuestionId>();
  const seenGroups = new Set<GroupId>();
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
    const pin = (questionId: QuestionId): void => {
      if (seenQuestions.has(questionId)) {
        errors.push({
          code: "DUPLICATE_QUESTION_IN_FORM",
          message: `Question "${questionId}" is pinned more than once (again in step "${step.stepId}")`,
          path: { step: step.stepId, question: questionId },
        });
      } else {
        seenQuestions.add(questionId);
      }
    };
    for (const item of step.items) {
      if (!isRepeatGroup(item)) {
        pin(item.questionId);
        continue;
      }
      if (seenGroups.has(item.groupId)) {
        errors.push({
          code: "DUPLICATE_GROUP_ID",
          message: `Group "${item.groupId}" appears more than once in the form`,
          path: { group: item.groupId, step: step.stepId },
        });
      } else {
        seenGroups.add(item.groupId);
      }
      // The parser refuses a nested group outright, so this branch only fires
      // for a definition built without `parseFormDefinition`.
      if (item.items.some((member) => isRepeatGroup(member))) {
        errors.push({
          code: "REPEAT_NESTING_NOT_ALLOWED",
          message: `Group "${item.groupId}" contains a repeating group; a group may not contain a group (ADR-42)`,
          path: { group: item.groupId, step: step.stepId },
        });
      }
      for (const member of item.items) {
        pin(member.questionId);
      }
      errors.push(...checkRepeatBounds(item, step.stepId));
      errors.push(...checkInstanceLabel(item));
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
 * A group's instance-count bounds are declared and coherent (ADR-42, SEC-16).
 *
 * `max` is required on every count source but `fixed`, because there is no
 * installation-wide ceiling: without it, a `fromAnswer` group lets the
 * respondent size the loop and an `open` group is an unbounded write path into
 * an append-only ledger. How small a `max` must be is deliberately unchecked.
 */
function checkRepeatBounds(group: RepeatGroup, stepId: StepId): PublishError[] {
  const errors: PublishError[] = [];
  const bounds = countBounds(group.count);
  if (bounds.max === undefined) {
    errors.push({
      code: "REPEAT_MAX_MISSING",
      message: `Group "${group.groupId}" takes its count from "${group.count.source}" and declares no max; every count source but "fixed" must declare one, because a group's own max is the only bound on how many instances a respondent may create (SEC-16)`,
      path: { group: group.groupId, step: stepId },
    });
    return errors;
  }
  if (bounds.min > bounds.max) {
    errors.push({
      code: "REPEAT_MIN_ABOVE_MAX",
      message: `Group "${group.groupId}" declares min ${String(bounds.min)} above max ${String(bounds.max)}, which no instance count can satisfy`,
      path: { group: group.groupId, step: stepId },
    });
  }
  return errors;
}

/**
 * The instance-label template carries `{n}`, the live one-based ordinal, and
 * nothing else (ADR-42). No placeholder at all is legal; any other placeholder
 * is refused because nothing substitutes it and the respondent reads the
 * braces. Every locale is checked, since a translation fails the same way.
 */
function checkInstanceLabel(group: RepeatGroup): PublishError[] {
  const errors: PublishError[] = [];
  for (const [locale, template] of Object.entries(group.instanceLabel)) {
    for (const placeholder of labelPlaceholders(template)) {
      if (placeholder !== INSTANCE_LABEL_PLACEHOLDER) {
        errors.push({
          code: "INSTANCE_LABEL_PLACEHOLDER_UNKNOWN",
          message: `Group "${group.groupId}" has an instance label in locale "${locale}" carrying the placeholder "{${placeholder}}"; the only placeholder is "{${INSTANCE_LABEL_PLACEHOLDER}}", the live one-based ordinal`,
          // The key of a parsed LocalizedText is a LocaleCode by construction.
          path: { group: group.groupId, locale: locale as LocaleCode, placeholder },
        });
      }
    }
  }
  return errors;
}

/**
 * A `fromAnswer` count source points at a `number` question. It needs the
 * resolved pin, so it sits with the other resolution-dependent checks rather
 * than with the structural ones. A count question the form does not pin is
 * skipped here and reported by `checkRuleResolution`.
 */
function checkRepeatCountTypes(
  definition: FormDefinition,
  resolved: ReadonlyMap<QuestionId, QuestionVersionRecord>,
): PublishError[] {
  const errors: PublishError[] = [];
  for (const step of definition.steps) {
    for (const item of step.items) {
      if (!isRepeatGroup(item) || item.count.source !== "fromAnswer") {
        continue;
      }
      const record = resolved.get(item.count.questionId);
      if (record === undefined || record.definition.type === "number") {
        continue;
      }
      errors.push({
        code: "REPEAT_COUNT_NOT_A_NUMBER",
        message: `Group "${item.groupId}" takes its instance count from question "${item.count.questionId}", which is ${record.definition.type} rather than number`,
        path: { group: item.groupId, question: item.count.questionId },
      });
    }
  }
  return errors;
}

/**
 * Every column of a `table`-presented group is an allowed cell type (ADR-43).
 * It needs the resolved pin, so it sits beside {@link checkRepeatCountTypes}.
 *
 * Reported per column rather than per group, because a publish report is always
 * complete (DOMAIN_SCHEMA §4.1). It fires on the presentation alone: the same
 * members under `stacked` or `perInstanceStep` publish untouched. A member the
 * form does not pin is skipped, since `resolvePins` already reports it.
 */
function checkTableColumnTypes(
  definition: FormDefinition,
  resolved: ReadonlyMap<QuestionId, QuestionVersionRecord>,
): PublishError[] {
  const errors: PublishError[] = [];
  const allowed = TABLE_COLUMN_TYPES.join(", ");
  for (const step of definition.steps) {
    for (const item of step.items) {
      if (!isRepeatGroup(item) || item.presentation !== "table") continue;
      for (const member of item.items) {
        const record = resolved.get(member.questionId);
        if (record === undefined || isTableColumnType(record.definition.type)) continue;
        errors.push({
          code: "TABLE_COLUMN_TYPE_NOT_ALLOWED",
          message: `Group "${item.groupId}" is presented as a table, and its column "${member.questionId}" is ${record.definition.type}; a table column is one of ${allowed}. Present this group as "stacked" instead, which allows every question type.`,
          path: {
            group: item.groupId,
            question: member.questionId,
            step: step.stepId,
            type: record.definition.type,
          },
        });
      }
    }
  }
  return errors;
}

/**
 * Every `QuestionRef` resolves to a stored, published version (I2, R1). A
 * record whose identity does not match the requested pin counts as
 * unresolvable, so a misbehaving lookup cannot smuggle the wrong content into
 * an immutable snapshot.
 */
function resolvePins(
  draft: DraftInput,
  resolved: Map<QuestionId, QuestionVersionRecord>,
): PublishError[] {
  const errors: PublishError[] = [];
  for (const step of draft.definition.steps) {
    // A question does not know it is repeated, so a group member's pin
    // resolves exactly like a step's own (ADR-42).
    const pins = step.items.flatMap((item) => (isRepeatGroup(item) ? item.items : [item]));
    for (const item of pins) {
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
 * Rule reference and target resolution within the form (I2). Option references
 * are `checkRuleTypes`'s, since they need the pinned version's options. A
 * `fromAnswer` count source reports `DANGLING_QUESTION_REF` like a rule read,
 * because a count source is a read of a question by the whole group.
 */
function checkRuleResolution(definition: FormDefinition): PublishError[] {
  const errors: PublishError[] = [];
  const pinned = new Set<QuestionId>(documentOrder(definition).map((entry) => entry.questionId));
  const steps = new Set<StepId>(definition.steps.map((step) => step.stepId));
  const groups = new Set<GroupId>(repeatGroups(definition.steps).map((group) => group.groupId));
  for (const step of definition.steps) {
    for (const item of step.items) {
      if (!isRepeatGroup(item) || item.count.source !== "fromAnswer") {
        continue;
      }
      if (!pinned.has(item.count.questionId)) {
        errors.push({
          code: "DANGLING_QUESTION_REF",
          message: `Group "${item.groupId}" takes its instance count from question "${item.count.questionId}", which is not pinned in the form`,
          path: { question: item.count.questionId, step: step.stepId },
        });
      }
    }
  }
  for (const rule of definition.rules) {
    for (const groupId of ruleGroupReferences(rule)) {
      if (!groups.has(groupId)) {
        errors.push({
          code: "DANGLING_GROUP_REF",
          message: `Rule "${rule.ruleId}" reads group "${groupId}", which the form does not declare; the rule would publish cleanly and never fire`,
          path: { rule: rule.ruleId, group: groupId },
        });
      }
    }
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
 * One authored `LocalizedText` in the draft. Enumerated once and consumed by
 * both text checks, so the two verdicts cannot drift apart.
 */
interface TextSite {
  readonly text: LocalizedText;
  /** How the report names this text, e.g. `Question "q_dob" label`. */
  readonly subject: string;
  readonly path: {
    readonly step?: StepId;
    readonly group?: GroupId;
    readonly question?: QuestionId;
    readonly option?: OptionId;
  };
}

/**
 * Every authored text on one pinned question version. The compile-time
 * resolver throws on a missing default locale, so a gap has to surface as a
 * publish error rather than as a compiler crash later.
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

/** Every authored text in the form and in its pinned versions, report order. */
function textSites(
  definition: FormDefinition,
  resolved: ReadonlyMap<QuestionId, QuestionVersionRecord>,
): TextSite[] {
  // Both titles are schema-required, so neither needs an undefined guard.
  const sites: TextSite[] = [{ text: definition.title, subject: "Form title", path: {} }];
  for (const step of definition.steps) {
    sites.push({
      text: step.title,
      subject: `Step "${step.stepId}" title`,
      path: { step: step.stepId },
    });
    // A group's own two texts are subject to the same verdicts as every other
    // authored text, and walking pinned questions alone would miss them.
    for (const item of step.items) {
      if (!isRepeatGroup(item)) {
        continue;
      }
      sites.push({
        text: item.label,
        subject: `Group "${item.groupId}" label`,
        path: { step: step.stepId, group: item.groupId },
      });
      sites.push({
        text: item.instanceLabel,
        subject: `Group "${item.groupId}" instance label`,
        path: { step: step.stepId, group: item.groupId },
      });
    }
  }
  for (const record of resolved.values()) {
    sites.push(...questionTextSites(record.definition));
  }
  return sites;
}

/**
 * Advisory: a rule reading a multiChoice answer and targeting a question on the
 * same step. A multiChoice answer commits on group exit (ADR-31), so the reveal
 * lands later than the author drew it. The draft is legal, hence a warning. A
 * cross-step target is correct by the same reasoning and does not warn.
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
 * Advisory: a shortText `pattern` whose character class carries an unescaped
 * `&&` or `--`. Both compile under either regex flag and mean different things
 * under each, with nothing failing downstream, so the authoring gate is the
 * only layer that can report it. See `classSetAmbiguity`.
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
 * carries (ADR-32). A message keyed by a constraint it does not carry can never
 * reach a respondent, so it is reported rather than left as dead content.
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
 * Default-locale completeness (I3). Only the default locale is checked, since
 * every other locale resolves through it (ADR-11).
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
 * No authored text is whitespace only.
 *
 * The rule lives here rather than in `LocalizedText`, which stays
 * `z.string().min(1)`: published snapshots are re-parsed on the serving path,
 * so a tightened schema would stop an already-published form from serving,
 * breaking R1. Reject what can be authored next, leave what is stored serving.
 *
 * Every locale is checked, since a blank translation reaches a respondent as a
 * nameless control exactly as a blank default label does.
 */
function checkBlankText(sites: readonly TextSite[]): PublishError[] {
  const errors: PublishError[] = [];
  for (const site of sites) {
    for (const [locale, value] of Object.entries(site.text)) {
      if (value.trim() === "") {
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
 * invariant, accumulating all errors rather than stopping at the first, and on
 * success return the deep-frozen `FrozenSnapshot`.
 *
 * Warnings describe a form that publishes correctly but probably does not
 * behave as its author drew it, so they never refuse a publish.
 *
 * The snapshot is a deep-frozen clone, leaving the caller's draft mutable: only
 * the snapshot is immutable (I1). Pure and deterministic (I7).
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
    ...checkRepeatCountTypes(definition, resolved),
    ...checkTableColumnTypes(definition, resolved),
  ];
  const sites = textSites(definition, resolved);
  errors.push(...checkLocaleCompleteness(definition, sites));
  errors.push(...checkBlankText(sites));
  errors.push(...checkAuthoredMessages(resolved));
  if (errors.length > 0) {
    return err(errors);
  }

  // Advisories are computed only once the draft is publishable: a warning
  // describes a snapshot that exists, and mixing the two channels would blur
  // the distinction they exist to keep.
  const warnings: PublishWarning[] = [
    ...checkMultiChoiceSameStepTargets(definition, resolved),
    ...checkPatternAmbiguity(resolved),
  ];

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
