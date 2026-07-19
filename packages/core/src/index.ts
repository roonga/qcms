/**
 * @qcms/core public surface (task 002: IDs, LocalizedText, canonical
 * AnswerValue, error primitives · task 003: question definitions · task 004:
 * form definitions and the typed publish error model · task 005: rules DSL
 * and dependency-graph analysis · task 006: the forward-pass rules evaluator,
 * ADR-16). Pure functions over immutable data — no I/O, no dependencies
 * beyond zod (R3).
 */
export { QcmsError, ok, err, qcmsError, type Result } from "./errors.js";

export {
  QuestionId,
  FormId,
  StepId,
  OptionId,
  RuleId,
  SessionId,
  parseQuestionId,
  parseFormId,
  parseStepId,
  parseOptionId,
  parseRuleId,
  parseSessionId,
  isQuestionId,
  isFormId,
  isStepId,
  isOptionId,
  isRuleId,
  isSessionId,
} from "./ids.js";

export {
  LocaleCode,
  LocalizedText,
  parseLocaleCode,
  parseLocalizedText,
  isLocaleCode,
  isLocalizedText,
  resolveText,
  isCompleteFor,
} from "./localized-text.js";

export {
  TextAnswerValue,
  NumberAnswerValue,
  DateAnswerValue,
  BooleanAnswerValue,
  SingleChoiceAnswerValue,
  MultiChoiceAnswerValue,
  AnswerValue,
  Comparable,
  type Ordering,
  parseTextAnswerValue,
  parseNumberAnswerValue,
  parseDateAnswerValue,
  parseBooleanAnswerValue,
  parseSingleChoiceAnswerValue,
  parseMultiChoiceAnswerValue,
  parseAnswerValue,
  parseComparable,
  isDateAnswerValue,
  isAnswerValue,
  isComparable,
  compareValues,
  valuesEqual,
} from "./answer-value.js";

export {
  SAFE_PATTERN_MAX_LENGTH,
  SAFE_PATTERN_MAX_BOUND,
  SAFE_PATTERN_MAX_COMPOSITE_BOUND,
  type SafePatternIssue,
  type SafePatternIssueCode,
  checkSafePattern,
  isSafePattern,
} from "./safe-pattern.js";

export {
  ChoiceOption,
  QuestionBase,
  QuestionDefinition,
  QuestionDefinitionError,
  QuestionDefinitionErrorCode,
  QuestionVersionRecord,
  QUESTION_TYPES,
  type QuestionType,
  optionIdsOf,
  parseQuestionDefinition,
  parseQuestionVersionRecord,
  isQuestionDefinition,
  isQuestionVersionRecord,
} from "./question-definition.js";

export {
  CONDITION_MAX_DEPTH,
  Condition,
  VisibilityRule,
  VisibilityRuleError,
  VisibilityRuleErrorCode,
  conditionDepth,
  parseCondition,
  parseVisibilityRule,
  isCondition,
  isVisibilityRule,
} from "./visibility-rule.js";

export {
  type DocumentPosition,
  type ResolveQuestion,
  type RuleGraphFinding,
  type RuleTypeFinding,
  documentOrder,
  ruleReferences,
  ruleTargets,
  analyzeRuleGraph,
  checkRuleTypes,
} from "./rule-graph.js";

export {
  QuestionRef,
  Step,
  FormDefinition,
  FormDefinitionError,
  FormDefinitionErrorCode,
  parseFormDefinition,
  isFormDefinition,
} from "./form-definition.js";

export {
  SEMANTICS_VERSION,
  EvalErrorCode,
  EvalError,
  FlowState,
  type AnswerMap,
  evaluateRules,
} from "./evaluate-rules.js";

export {
  PublishErrorCode,
  PublishError,
  type PublishErrorOf,
  type FrozenSnapshot,
  type PublishResult,
  publishErrorLocation,
} from "./publish-error.js";
