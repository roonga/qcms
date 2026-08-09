import { describe, expect, it } from "vitest";

import * as queries from "./index.js";

/**
 * Exit criterion 2: `createSession` pins `formVersion` and **no exported helper
 * mutates it** - the pin's immutability (I4) is structural, enforced by the
 * absence of a write path, not by a runtime check. This test guards that
 * absence at the API surface so a future helper that sets `form_version` cannot
 * land unnoticed.
 */
describe("query helper import surface", () => {
  const exportNames = Object.keys(queries).filter(
    (name) => typeof (queries as Record<string, unknown>)[name] === "function",
  );

  // The complete, intended public function surface. Pinning it means a new
  // helper - including any that could re-pin a session's form version - cannot
  // land without updating this list, where review can see it.
  const EXPECTED_HELPERS = [
    // questions
    "createQuestion",
    "createQuestionVersion",
    "publishQuestionVersion",
    "deprecateQuestionVersion",
    "getQuestionVersion",
    "getQuestion",
    "listQuestionVersions",
    "updateDraftDefinition",
    "listQuestions",
    "isQuestionIdTaken",
    // forms
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
    "closeForm",
    "reopenForm",
    "updateFormSettings",
    // sessions
    "createSession",
    "getSession",
    "markInProgress",
    "markSubmitted",
    "expireSessions",
    // secure links
    "insertSecureLink",
    "getSecureLink",
    "listSecureLinks",
    "consumeSecureLink",
    "revokeSecureLink",
    // webhooks (task 024) - per-form config rows; the secret is opaque
    // ciphertext at this layer, never handled in plaintext here.
    "insertWebhook",
    "listWebhooks",
    "getWebhook",
    "updateWebhook",
    "deactivateWebhook",
    // answers - `retractAnswer` appends a tombstone (ADR-33), never an UPDATE or
    // DELETE, so it widens no mutation door; `isRetraction` is a pure narrower.
    "appendAnswer",
    "retractAnswer",
    "isRetraction",
    "latestAnswers",
    "answerLedger",
    // submissions
    "insertSubmission",
    "getSubmission",
    // reporting reads (task 023) - erasure-safe view reads for the data-out
    // admin surface. `clearSubmissionFlag` is a flag-release write (unflag); it
    // sets no form version, so it does not widen the version-mutation surface.
    "listResponses",
    "getResponse",
    "fetchResponsePage",
    "listTombstones",
    "clearSubmissionFlag",
    // retention (task 015) - sweep/purge are named for their action, not as
    // session mutators; sessionExpiresAt is a pure TTL-policy helper.
    "sweepExpiredSessions",
    "purgeExpired",
    "sessionExpiresAt",
    // erasure (task 016, ADR-17) - the sanctioned whole-session delete door;
    // SessionNotFoundError is the typed throw. The scoped-guard mechanics stay
    // internal (imported by module path), not on the public surface.
    "eraseSession",
    "SessionNotFoundError",
    // outbox
    "backoffDelayMs",
    "computeBackoff",
    "enqueue",
    "claimDue",
    "markDelivered",
    "recordFailure",
    "listDeadLetters",
    // The time-based half of the payload's retention story (#329): the answers an
    // event carries, dropped by the existing retention-sweep scheduler once the
    // event and its whole fan-out have settled past the redelivery window. Erasure
    // is the on-request half and runs inside `eraseSession`, so it has no separate
    // entry here.
    "redactAgedOutboxPayloads",
    "resetForRedelivery",
    // webhook deliveries (task 025) - the per-(event, webhook) fan-out unit;
    // shape-preserving claim/record/reset helpers, no signing or HTTP here.
    "insertDelivery",
    "claimDueDeliveries",
    "markDeliveryDelivered",
    "recordDeliveryFailure",
    "listDeadLetterDeliveries",
    // The operator dashboard's form-scoped list (task 035): the same delivery rows
    // plus the last-attempt record the deliverer writes.
    "listRecentDeliveries",
    // The ADR-17 rule the manual redeliver door reads (059, replacing 035's
    // tombstone lookup): the same cancelled/redacted state `claimDueDeliveries`
    // filters on, so the handler's refusal and the scheduler's filter cannot drift.
    "redeliveryRefusalFor",
    // The time-based half of the response-snippet retention story (#304): the one
    // delivery column that can hold a respondent's own words, aged out by the
    // existing retention-sweep scheduler. Erasure is the on-request half and runs
    // inside `eraseSession`, so it has no separate entry here.
    "redactAgedResponseSnippets",
    "resetDeliveryForRedelivery",
    // admin identity reads (task 031) - reads only. better-auth owns every write
    // to the auth tables, so no helper here creates, refreshes or deletes a
    // session, and none returns a credential (no password hash, no TOTP secret,
    // no backup codes).
    "getAdminSessionByToken",
    "countAdminUsers",
  ];

  it("exposes exactly the intended query-helper surface", () => {
    expect(new Set(exportNames)).toEqual(new Set(EXPECTED_HELPERS));
  });

  it("exposes exactly one session write path that sets a form version: createSession", () => {
    // The only exported helper that writes `form_version` is `createSession`
    // (at creation). Every other session helper is a status-only transition or
    // a read - I4 (a session never migrates form versions) is structural.
    const sessionMutators = exportNames.filter(
      (name) =>
        /^(create|mark|expire|set|change|update|migrate|repin|move)/i.test(name) &&
        /(session|pin|formversion)/i.test(name),
    );
    expect(new Set(sessionMutators)).toEqual(new Set(["createSession", "expireSessions"]));
    // markInProgress / markSubmitted are status-only and named accordingly.
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
