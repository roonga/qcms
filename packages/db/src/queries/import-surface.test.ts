import { describe, expect, it } from "vitest";

import * as queries from "./index.js";

/** The pin on a session's `formVersion` is enforced by the absence of a write path. */
describe("query helper import surface", () => {
  const exportNames = Object.keys(queries).filter(
    (name) => typeof (queries as Record<string, unknown>)[name] === "function",
  );

  const EXPECTED_HELPERS = [
    "createQuestion",
    "createQuestionVersion",
    "publishQuestionVersion",
    "deprecateQuestionVersion",
    "getQuestionVersion",
    "getQuestion",
    "listQuestionVersions",
    "listVersionsForQuestions",
    "updateDraftDefinition",
    "listQuestions",
    "listQuestionOwnership",
    "moveQuestionToWorkspace",
    "isQuestionIdTaken",
    "isQuestionIdInAnswerLedger",
    "getFormBySlug",
    "getForm",
    "listForms",
    "createForm",
    "upsertDraft",
    "getDraft",
    "deleteDraft",
    "insertFormVersion",
    "getFormVersion",
    "getLatestPublishedVersion",
    "listFormVersions",
    "moveFormToWorkspace",
    "publishedTitlesByForm",
    "updateFormSettings",
    "listWorkspaces",
    "listActiveWorkspaces",
    "getWorkspace",
    "getWorkspaceBySlug",
    "getSharedWorkspace",
    "setWorkspaceShared",
    "archiveWorkspace",
    "findArchiveBlockers",
    "countWorkspaceContents",
    "ensureSeedWorkspace",
    "listEnvironments",
    "getEnvironmentChallengeProvider",
    "listEnvironmentRetention",
    "insertFormRelease",
    "getReleasedVersion",
    "getFormEnvironmentState",
    "environmentStatesByForm",
    "closeFormInEnvironment",
    "reopenFormInEnvironment",
    "listFormReleases",
    "lastReleaseAtByForm",
    "listReleasedVersions",
    "createSession",
    "getSession",
    "getSessionInForm",
    "markInProgress",
    "markSubmitted",
    "expireSessions",
    "insertSecureLink",
    "getSecureLink",
    "listSecureLinks",
    "consumeSecureLink",
    "revokeSecureLink",
    "insertWebhook",
    "listWebhooks",
    "getWebhook",
    "updateWebhook",
    "deactivateWebhook",
    "appendAnswer",
    "retractAnswer",
    "isRetraction",
    "latestAnswers",
    "answerLedger",
    "addInstances",
    "removeInstance",
    "readRoster",
    "readRosters",
    "rosterLedger",
    "rosterOpApplied",
    "insertSubmission",
    "getSubmission",
    "listResponses",
    "getResponse",
    "fetchResponsePage",
    "listTombstones",
    "responseCountsByForm",
    "clearSubmissionFlag",
    "sweepExpiredSessions",
    "purgeExpired",
    "sessionExpiresAt",
    "eraseSession",
    "SessionNotFoundError",
    "findSubjectPresence",
    "backoffDelayMs",
    "computeBackoff",
    "enqueue",
    "enqueueInEnvironment",
    "claimDue",
    "markDelivered",
    "recordFailure",
    "listDeadLetters",
    "redactAgedOutboxPayloads",
    "outboxRedeliveryRefusalFor",
    "resetForRedelivery",
    "insertDelivery",
    "claimDueDeliveries",
    "markDeliveryDelivered",
    "recordDeliveryFailure",
    "listDeadLetterDeliveries",
    "listRecentDeliveries",
    "redeliveryRefusalFor",
    "redactAgedResponseSnippets",
    "resetDeliveryForRedelivery",
    "getAdminSessionByToken",
    "countAdminUsers",
    "clearMustChangePassword",
    "findAdminsByEmail",
    "clearAdminTwoFactor",
    "recordTwoFactorReset",
    "readConnectedRole",
    "resolveMembership",
    "listGrantsForUser",
    "listWorkspaceMembers",
    "listMemberWorkspacesForUser",
    "listAccessGroups",
    "getAccessGroup",
    "isAccessGroupNameTaken",
    "listAccessGroupHolders",
    "createAccessGroup",
    "updateAccessGroupScope",
    "deleteAccessGroup",
    "ensureWorkspaceMember",
    "setMemberRole",
    "countWorkspaceOwners",
    "addAccessGroupHolder",
    "removeAccessGroupHolder",
    "holdsAccessGroup",
    "listGroupsNamingEnvironment",
    "listEnvironmentNames",
    "setSeedNewEditorsWithTestData",
    "setRequireSecondApprover",
    "readSeedNewEditorsWithTestData",
    "findUserByEmail",
    "findUsersByIds",
    "isScopeAll",
    "writeAccessAuditRow",
    "listAccessAudit",
    "countAccessAuditByKind",
    "insertEndpointProposal",
    "getEndpointProposal",
    "listOpenEndpointProposals",
    "hasPendingEndpointProposal",
    "confirmEndpointProposal",
    "markEndpointProposalApplied",
    "withdrawEndpointProposal",
  ];

  it("exposes exactly the intended query-helper surface", () => {
    expect(new Set(exportNames)).toEqual(new Set(EXPECTED_HELPERS));
  });

  it("exposes exactly one session write path that sets a form version: createSession", () => {
    const sessionMutators = exportNames.filter(
      (name) =>
        /^(create|mark|expire|set|change|update|migrate|repin|move)/i.test(name) &&
        /(session|pin|formversion)/i.test(name),
    );
    expect(new Set(sessionMutators)).toEqual(new Set(["createSession", "expireSessions"]));
  });

  it("exports no path that deletes a workspace (task 068, criterion 5)", () => {
    const workspaceWriters = exportNames.filter((name) => /workspace/i.test(name));
    expect(
      workspaceWriters.filter((name) => /^(delete|remove|drop|purge|erase)/i.test(name)),
    ).toEqual([]);
    expect(workspaceWriters).toContain("archiveWorkspace");
  });

  it("exports no helper named for mutating a form version", () => {
    const versionMutators = exportNames.filter(
      (name) =>
        /(set|change|update|migrate|repin|move|reassign).*version/i.test(name) &&
        !/^(insert|create)/i.test(name),
    );
    expect(versionMutators).toEqual([]);
    for (const name of exportNames) {
      expect(name).not.toMatch(/setFormVersion|changeFormVersion|repinSession|migrateSession/i);
    }
  });
});
