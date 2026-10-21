/**
 * Query helpers (task 014): the loading/persisting vocabulary the API slices
 * call. Every helper takes an {@link Executor} (a Drizzle handle or a
 * transaction) as its **first argument** so slices own transaction boundaries
 * (R3). These are shape-preserving reads and writes only - no business logic,
 * no validation, no rule evaluation (that is `@roonga/qcms-core`'s job, R5).
 */

export type { Executor } from "./executor.js";

// Admin identity reads (task 031): the two reads better-auth's non-shell consumers
// need - session verification in the API middleware, and the first-run bootstrap
// guard. better-auth owns every write to the auth tables EXCEPT the two below.
export { type AdminSessionRow, getAdminSessionByToken, countAdminUsers } from "./auth.js";

// SEC-1's provisional bootstrap credential (task 061). The flag itself is a
// better-auth `additionalFields` entry, so the library sets it when it creates the
// account and returns it on the session user; this clears it, called from the one
// database hook that fires when a password is actually changed. `auth.js` records why
// the library has no concept that would write it.
export { clearMustChangePassword } from "./auth.js";

// The `qcms:reset-2fa` break-glass (issue #432): resolve the account an operator
// named, delete its second factor and recovery codes, and append the audit row.
// `clearAdminTwoFactor` is that exception - the one write to the auth tables in
// this package, and a deletion. `auth.js` records why the library cannot do it.
export {
  type AdminIdentityRow,
  type TwoFactorResetRecord,
  findAdminsByEmail,
  clearAdminTwoFactor,
  recordTwoFactorReset,
} from "./auth.js";

// SEC-10: which Postgres role this connection holds, and whether it owns the
// schema. The break-glass refuses to run as the application credential.
export { type ConnectedRole, RESET_TABLE_COUNT, readConnectedRole } from "./database-role.js";

export {
  type QuestionRow,
  type QuestionVersionRow,
  type QuestionStatus,
  type QuestionSummary,
  createQuestion,
  createQuestionVersion,
  publishQuestionVersion,
  deprecateQuestionVersion,
  getQuestionVersion,
  getQuestion,
  listQuestionVersions,
  listVersionsForQuestions,
  updateDraftDefinition,
  listQuestions,
  listQuestionOwnership,
  moveQuestionToWorkspace,
  isQuestionIdTaken,
  isQuestionIdInAnswerLedger,
  type QuestionOwnership,
} from "./questions.js";

export {
  type FormRow,
  type FormStatus,
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
  moveFormToWorkspace,
  updateFormSettings,
} from "./forms.js";

// Workspaces (ADR-41, task 068): a workspace is better-auth's `organization` row, and
// these are the QCMS reads of it plus the two writes its own fields take - the shared
// flag and the archive stamp. Creating one is the library's call (`createOrganization`),
// except for `ensureSeedWorkspace`, which is the fixture path and says why.
export {
  type WorkspaceRow,
  type ArchiveBlockers,
  type WorkspaceContents,
  SEED_WORKSPACE_ID,
  SEED_WORKSPACE_NAME,
  SEED_WORKSPACE_SLUG,
  listWorkspaces,
  listActiveWorkspaces,
  getWorkspace,
  getWorkspaceBySlug,
  getSharedWorkspace,
  setWorkspaceShared,
  archiveWorkspace,
  findArchiveBlockers,
  countWorkspaceContents,
  ensureSeedWorkspace,
} from "./workspaces.js";

// Membership and grants (ADR-41, Q32, Q45; task 069). QCMS owns every write to the
// plugin's `member`, `team` and `teamMember` rows, because the QCMS endpoints are where
// the validation and the SEC-15 rows live and the plugin's removal cascades run below any
// endpoint this layer could gate. `grants.js` records the whole reasoning.
export {
  type AccessGroupRow,
  type EnvironmentNamingGroup,
  type HeldGrant,
  type MemberWorkspace,
  type Membership,
  type NewAccessGroup,
  type WorkspaceMemberRow,
  EMPTY_MEMBER_ROLE,
  OWNER_MEMBER_ROLE,
  addAccessGroupHolder,
  countWorkspaceOwners,
  createAccessGroup,
  deleteAccessGroup,
  ensureWorkspaceMember,
  findUserByEmail,
  findUsersByIds,
  getAccessGroup,
  holdsAccessGroup,
  isAccessGroupNameTaken,
  isScopeAll,
  listAccessGroupHolders,
  listAccessGroups,
  listEnvironmentNames,
  listGrantsForUser,
  listGroupsNamingEnvironment,
  listMemberWorkspacesForUser,
  listWorkspaceMembers,
  readSeedNewEditorsWithTestData,
  removeAccessGroupHolder,
  resolveMembership,
  setMemberRole,
  setRequireSecondApprover,
  setSeedNewEditorsWithTestData,
  updateAccessGroupScope,
} from "./grants.js";

// The SEC-15 access audit (Q31, Q56, Q57, Q61; task 069). One helper writes the rows for
// both pools, which is what makes the no-`RETURNING` rule the helper's rather than either
// role's; `access-audit.js` records why.
export {
  type AccessAuditEntry,
  type AccessAuditRow,
  countAccessAuditByKind,
  listAccessAudit,
  writeAccessAuditRow,
} from "./access-audit.js";

// The pending `prod` endpoint change (Q30, Q51; task 070). Control-plane state with a
// lifecycle, whose state transitions are conditional updates so the database picks the
// winner of a race rather than two confirmations both applying; `endpoint-proposals.js`
// records why, and why the apply is the one step that is not here.
export {
  type EndpointProposalRow,
  confirmEndpointProposal,
  getEndpointProposal,
  hasPendingEndpointProposal,
  insertEndpointProposal,
  listOpenEndpointProposals,
  markEndpointProposalApplied,
  withdrawEndpointProposal,
} from "./endpoint-proposals.js";

export {
  type SessionRow,
  type SessionStatus,
  type AccessMode,
  createSession,
  getSession,
  getSessionInForm,
  markInProgress,
  markSubmitted,
  expireSessions,
} from "./sessions.js";

export {
  type SecureLinkRow,
  insertSecureLink,
  getSecureLink,
  listSecureLinks,
  consumeSecureLink,
  revokeSecureLink,
} from "./secure-links.js";

export {
  type WebhookRow,
  insertWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deactivateWebhook,
} from "./webhooks.js";

export {
  type AnswerRow,
  type RetractionRow,
  appendAnswer,
  retractAnswer,
  isRetraction,
  latestAnswers,
  answerLedger,
} from "./answers.js";

// The append-only roster of repeating-group instances (ADR-42, task 072). These
// are the raw event reads and writes; deriving the LIVE roster from them is a
// function of the group's count source and runs in the API, above `evaluateRules`
// (`apps/api/src/features/responses/roster.ts`).
export {
  type GroupRoster,
  type RosterEventRow,
  addInstances,
  removeInstance,
  readRoster,
  readRosters,
  rosterLedger,
  rosterOpApplied,
} from "./rosters.js";

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
// `ANSWER_DELETE_GUARD_SETTING`) stay internal to the package - retention imports
// them by module path - so the sanctioned DELETE door cannot be opened by callers
// outside `eraseSession`/`purgeExpired`.
//
// `findSubjectPresence` is beside it rather than inside it: Q7's cross-environment offer
// needs to know whether another environment holds anything for a subject, and that is a
// **read** of existence that opens no door at all (task 067).
export {
  SessionNotFoundError,
  type SubjectPresence,
  eraseSession,
  findSubjectPresence,
} from "./erasure.js";

// The live environment set (ADR-40, Q1): the source of which environments exist, read
// by the admin's Q6 switcher and by every per-environment job that enumerates them.
export {
  type EnvironmentRetentionRow,
  type EnvironmentRow,
  getEnvironmentChallengeProvider,
  listEnvironmentRetention,
  listEnvironments,
} from "./environments.js";

// The release record (ADR-40, task 065): what is released to an environment, which is
// what a new session resolves in place of "the newest published version". Promotion
// writes a row and copies nothing, and the rollback reading is derived from the row's
// predecessor rather than stored.
//
// Since task 066 the same state carries the **closed** reading (Q18), so closing and
// reopening are appends here rather than an update to a column on `forms`.
export {
  type FormEnvironmentState,
  type FormReleaseHistoryRow,
  type FormReleaseRow,
  closeFormInEnvironment,
  environmentStatesByForm,
  getFormEnvironmentState,
  getReleasedVersion,
  insertFormRelease,
  listFormReleases,
  listReleasedVersions,
  reopenFormInEnvironment,
} from "./releases.js";

export {
  type OutboxRow,
  type OutboxPayloadRedactionResult,
  type OutboxRedeliveryRefusal,
  DEFAULT_OUTBOX_PAYLOAD_RETENTION_MS,
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_BACKOFF_FACTOR,
  OUTBOX_BACKOFF_CAP_MS,
  OUTBOX_MAX_ATTEMPTS,
  backoffDelayMs,
  computeBackoff,
  enqueue,
  enqueueInEnvironment,
  claimDue,
  markDelivered,
  recordFailure,
  listDeadLetters,
  redactAgedOutboxPayloads,
  outboxRedeliveryRefusalFor,
  resetForRedelivery,
} from "./outbox.js";

// Per-(event, webhook) delivery state (task 025): the fan-out unit. One outbox
// event becomes N delivery rows (one per active webhook), each with independent
// retry/backoff/dead-letter state, sharing the outbox's `computeBackoff` schedule.
export {
  type DeliveryRow,
  type DueDelivery,
  type DeadLetterDelivery,
  type DeliveryAttemptRecord,
  type DeliveryView,
  type RedeliveryRefusal,
  type SnippetRedactionResult,
  DELIVERY_CANCELLED_SESSION_ERASED,
  DEFAULT_RESPONSE_SNIPPET_RETENTION_MS,
  redactAgedResponseSnippets,
  insertDelivery,
  claimDueDeliveries,
  markDeliveryDelivered,
  recordDeliveryFailure,
  redeliveryRefusalFor,
  listDeadLetterDeliveries,
  listRecentDeliveries,
  resetDeliveryForRedelivery,
} from "./deliveries.js";
