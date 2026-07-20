/**
 * Query helpers (task 014): the loading/persisting vocabulary the API slices
 * call. Every helper takes an {@link Executor} (a Drizzle handle or a
 * transaction) as its **first argument** so slices own transaction boundaries
 * (R3). These are shape-preserving reads and writes only — no business logic,
 * no validation, no rule evaluation (that is `@qcms/core`'s job, R5).
 */

export type { Executor } from "./executor.js";

export {
  type QuestionRow,
  type QuestionVersionRow,
  type QuestionSummary,
  createQuestion,
  createQuestionVersion,
  publishQuestionVersion,
  deprecateQuestionVersion,
  getQuestionVersion,
  getQuestion,
  listQuestionVersions,
  updateDraftDefinition,
  listQuestions,
  isQuestionIdTaken,
} from "./questions.js";

export {
  type FormRow,
  type FormDraftRow,
  type FormVersionRow,
  getFormBySlug,
  getForm,
  listForms,
  createForm,
  upsertDraft,
  getDraft,
  deleteDraft,
  insertFormVersion,
  getFormVersion,
  getLatestPublishedVersion,
  listFormVersions,
  closeForm,
  reopenForm,
} from "./forms.js";

export {
  type SessionRow,
  type AccessMode,
  createSession,
  getSession,
  markInProgress,
  markSubmitted,
  expireSessions,
} from "./sessions.js";

export {
  type SecureLinkRow,
  insertSecureLink,
  getSecureLink,
  consumeSecureLink,
  revokeSecureLink,
} from "./secure-links.js";

export { type AnswerRow, appendAnswer, latestAnswers, answerLedger } from "./answers.js";

export { type SubmissionRow, insertSubmission, getSubmission } from "./submissions.js";

export {
  type ReportingResponseRow,
  type ResponseListRow,
  type ResponseDetailRow,
  type ResponseFilter,
  type TombstoneRow,
  listResponses,
  getResponse,
  fetchResponsePage,
  listTombstones,
  clearSubmissionFlag,
} from "./reporting.js";

export {
  type SessionTtlConfig,
  type SweepResult,
  type PurgeResult,
  DEFAULT_ANONYMOUS_SESSION_TTL_MS,
  DEFAULT_SESSION_TTL,
  sessionExpiresAt,
  sweepExpiredSessions,
  purgeExpired,
} from "./retention.js";

// `eraseSession` is the public erasure door; `SessionNotFoundError` is its typed
// throw. The scoped-guard mechanics (`openAnswerDeleteDoor`,
// `ANSWER_DELETE_GUARD_SETTING`) stay internal to the package — retention imports
// them by module path — so the sanctioned DELETE door cannot be opened by callers
// outside `eraseSession`/`purgeExpired`.
export { SessionNotFoundError, eraseSession } from "./erasure.js";

export {
  type OutboxRow,
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_BACKOFF_FACTOR,
  OUTBOX_BACKOFF_CAP_MS,
  OUTBOX_MAX_ATTEMPTS,
  backoffDelayMs,
  computeBackoff,
  enqueue,
  claimDue,
  markDelivered,
  recordFailure,
  listDeadLetters,
  resetForRedelivery,
} from "./outbox.js";
