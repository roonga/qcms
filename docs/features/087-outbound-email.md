# 087 - Outbound email

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api`, compose files, `create-qcms-app` templates · **Depends on:** the workspace access spec on `main`; the Code Owner's approval of the mail dependency
**References:** `docs/WORKSPACE_ACCESS.md` section 7 (creation) and section 16 · `CONTRIBUTING.md` (dependency thresholds) · `docs/features/061-forced-password-change.md` · `plan/work-order-sequence.md`

## Context

QCMS has no mail transport. Account creation, reactivation and reset all send an emailed single-use link, so 090 and 091 wait on this task. It can start early, in parallel with 085.

## Open ruling

The mail dependency needs the Code Owner's runtime dependency approval. **Proposed: `nodemailer` over SMTP.** The executor brings the risk assessment in the PR and does not merge before the ruling. If the ruling is not in, park with `HANDOFF: AWAITING-HUMAN`.

## Deliverables

- A mail port in `apps/api` (send, typed failure) and an SMTP transport behind it.
- Configuration `QCMS_SMTP_*`, the sender, and the admin base URL for links. Non-TLS SMTP is refused outside development.
- Plain-text and HTML templates for sign-in links (en).
- A "mail configured" check other features read; account creation and reactivation consume it in 090 and 091.
- Mailpit in the e2e compose and a test helper that reads it.
- `docs/DEVELOPER_GUIDE.md` section on outbound email.

## Exit criteria

No spec criterion is owned here; 090 owns criteria 50 and 51, which rest on this task.

- A test message reaches Mailpit in e2e.
- The dependency risk assessment is in the PR.

## Negative tests

- The link is never logged.
- The message body carries no secret beyond the link.
- A transport error does not reveal whether an address exists.
- Non-TLS SMTP configuration is refused outside development.

## Files and areas

`apps/api/src/features/email/` (new), `apps/api/src/config.ts`, compose files, `apps/api/e2e/support/`, `packages/create-qcms-app/templates/`, `docs/DEVELOPER_GUIDE.md`, `package.json` and `pnpm-lock.yaml` for the dependency.

## Migration

None.

## Gates

V, D, E (`plan/work-order-sequence.md`, Gates).

## Review

Opus first round; Sonnet delta.

## Design gate

None.

## Out of scope

Account routes (090). Resend and delivery status (090). Any non-English template.
