export type { Executor } from "./executor.js";

export { type AdminSessionRow, getAdminSessionByToken, countAdminUsers } from "./auth.js";

export { clearMustChangePassword } from "./auth.js";

export {
  type AdminIdentityRow,
  type TwoFactorResetRecord,
  findAdminById,
  findAdminsByEmail,
  clearAdminTwoFactor,
  recordTwoFactorReset,
} from "./auth.js";

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
  latestVersionsByForm,
  listFormVersions,
  lockForm,
  moveFormToWorkspace,
  publishedTitlesByForm,
  updateFormSettings,
} from "./forms.js";

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

export {
  type AccessAuditEntry,
  type AccessAuditRow,
  countAccessAuditByKind,
  listAccessAudit,
  writeAccessAuditRow,
} from "./access-audit.js";

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
  type ResponseCounts,
  type ResponseMetadataRow,
  type TombstoneRow,
  listResponses,
  listResponseMetadata,
  responseCountsByForm,
  getResponse,
  getResponseMetadata,
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

// `openAnswerDeleteDoor` and `ANSWER_DELETE_GUARD_SETTING` stay unexported so the
// sanctioned DELETE door cannot be opened outside `eraseSession`/`purgeExpired`.
export {
  SessionNotFoundError,
  type SubjectPresence,
  eraseSession,
  findSubjectPresence,
} from "./erasure.js";

export {
  type EnvironmentRetentionRow,
  type EnvironmentRow,
  getEnvironmentChallengeProvider,
  listEnvironmentRetention,
  listEnvironments,
} from "./environments.js";

export {
  type FormEnvironmentState,
  type FormReleaseHistoryRow,
  type FormReleaseRow,
  closeFormInEnvironment,
  environmentStatesByForm,
  getFormEnvironmentState,
  getReleasedVersion,
  insertFormRelease,
  lastReleaseAtByForm,
  listFormReleases,
  listReleasedVersions,
  reopenFormInEnvironment,
} from "./releases.js";

export {
  type ReleaseWorkflowRevision,
  type ReleaseWorkflowRule,
  effectiveReleaseWorkflow,
  insertReleaseWorkflowRevision,
  latestReleaseWorkflowRevision,
} from "./release-workflow.js";

export {
  type ReleaseBatchPurgeResult,
  type ReleaseBatchRow,
  RELEASE_BATCH_RETENTION_MS,
  getReleaseBatch,
  insertReleaseBatch,
  purgeExpiredReleaseBatches,
} from "./release-batches.js";

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
