/**
 * @qcms/core public surface (task 002: IDs, LocalizedText, canonical
 * AnswerValue, error primitives). Pure functions over immutable data — no
 * I/O, no dependencies beyond zod (R3).
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
