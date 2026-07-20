# 020 - submit slice (lock + outbox)

**Stage:** 6 · **App:** `apps/api` (`features/responses/submit`) · **Depends on:** 019
**References:** `DOMAIN_SCHEMA.md` §4.3 · ADR-07 · I5, I6, I9 · `ARCHITECTURE.md` §11 (egress reliability)

## Context

The audit boundary. Submission validates everything visible-required through the kernel, locks the answer set, and writes the `response.submitted` outbox event - all in one transaction, so an integration can never observe a submission that isn't durable, and a submission can never miss its event.

## Deliverables

- `POST /sessions/:id/submit` (session-token authed):
  1. Session active (`created` alone → `NOTHING_TO_SUBMIT`; `submitted` → idempotent success returning the existing submission receipt; `expired` → typed reject).
  2. Load snapshot + `latestAnswers` → `prepareSubmission` (009). Failure → 422 with `missingRequired` / `INVALID_ANSWER` details (portal navigates the respondent back).
  3. One transaction: `insertSubmission` (store the **whole** `LockedSubmission` in `lockedAnswers` - the 0003 reporting view reads `locked_answers -> 'answers'`, so storing only `.answers` silently breaks reporting - plus `contentHash`) · `markSubmitted` · `enqueue(tx, response.submitted)` with payload `{ sessionId, formId, formVersion, submittedAt, contentHash, answers }` (the webhook payload carries just the answer array).
  4. Response: `{ submittedAt, contentHash }` - the respondent's receipt.
- Anti-abuse hooks (wired here, tuned in 026): honeypot field check and minimum-time-to-complete against session `createdAt` - both return the *same* generic success-shaped response while flagging the submission (`flagged` column or metadata on submissions; silent rejection is deliberate - do not teach bots the tells).
- Post-submit `GET /sessions/:id/step` returns a completed state; further answers rejected (`SESSION_SUBMITTED`).

## Exit criteria

1. Happy path: submission row, session status, and outbox row all present; all-or-nothing under induced mid-transaction failure.
2. Idempotency: double submit → same receipt, one submission row, one outbox row.
3. Hidden-answer exclusion: hidden-question answer absent from lockedAnswers and webhook payload, present in ledger.
4. Missing visible-required → 422 with ids; hidden required does not block.
5. Honeypot-filled and too-fast submissions: success-shaped response, flagged internally, no outbox event (documented choice - flagged submissions withheld from webhooks pending review; revisit in 035).

## Out of scope

Webhook delivery (025), export (023), portal completion UI (029).
