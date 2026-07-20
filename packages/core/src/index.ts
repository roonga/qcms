/**
 * @qcms/core public surface (task 002: IDs, LocalizedText, canonical
 * AnswerValue, error primitives · task 003: question definitions · task 004:
 * form definitions and the typed publish error model · task 005: rules DSL
 * and dependency-graph analysis · task 006: the forward-pass rules evaluator,
 * ADR-16 · task 008: `compileDraft`, the publish aggregate · task 009:
 * `validateAnswer` and `prepareSubmission`, the submission lock · task 010:
 * purpose-tagged compact tokens and secure links, SEC-2/SEC-7). Pure
 * functions over immutable data — no I/O beyond WebCrypto, no dependencies
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
  LinkId,
  parseQuestionId,
  parseFormId,
  parseStepId,
  parseOptionId,
  parseRuleId,
  parseSessionId,
  parseLinkId,
  isQuestionId,
  isFormId,
  isStepId,
  isOptionId,
  isRuleId,
  isSessionId,
  isLinkId,
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

export {
  SNAPSHOT_SCHEMA_VERSION,
  type DraftInput,
  type ResolveQuestionVersion,
  compileDraft,
} from "./compile-draft.js";

export {
  ValidationConstraint,
  ValidationErrorCode,
  ValidationError,
  validateAnswer,
} from "./validate-answer.js";

export {
  SubmissionErrorCode,
  SubmissionError,
  LockedAnswer,
  LockedSubmission,
  canonicalJson,
  computeContentHash,
  prepareSubmission,
} from "./prepare-submission.js";

export {
  TOKEN_PURPOSES,
  TokenPurpose,
  CompactTokenErrorCode,
  CompactTokenError,
  type CompactTokenClaims,
  COMPACT_TOKEN_KEY_ALGORITHM,
  COMPACT_TOKEN_MIN_KEY_BYTES,
  importCompactTokenKey,
  signCompactToken,
  verifyCompactToken,
} from "./compact-token.js";

export {
  LinkClaims,
  LinkErrorCode,
  LinkError,
  mintSecureLink,
  verifySecureLink,
} from "./secure-link.js";

export { EraseRequest, EraseOutcome, EraseErrorCode } from "./erasure.js";
