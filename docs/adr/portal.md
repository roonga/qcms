# Portal decisions

**Status:** authoritative. Part of the decision record indexed in [`README.md`](README.md). These decisions bind only the respondent portal. Shared decisions that also bind the portal (ADR-08, ADR-22, ADR-26, ADR-27, ADR-38 and the rest) live in [`core.md`](core.md); the operational summary is `docs/portal-constraints.md`.

---

### ADR-12 - Accessible abuse controls

**Status:** implemented; see note.

**Decision.** Rate limits, session binding, honeypots, and timing checks are the baseline. A typed challenge-provider adapter is optional and off by default. Visible challenges are not the default.

**Note.** The API-side Turnstile verifier is still a fail-closed stub (task 029 remainder): the portal widget, CSP allowance, and config validation exist, but with a provider configured, verification cannot yet succeed. The `RATE_ANOMALY` flag reason is reserved and never produced.

### ADR-28 - Explicit portal navigation

**Status:** implemented; see notes.

**Decision.** Continue advances only after current-step validation, Back returns to the previous visible step and is hidden on the first step, and Submit appears only on the last visible step. Answering never changes the rendered step by itself.

**Note (flagged).** Two open edges:

1. The no-JS fallback renders a single button whose label follows overall submit-readiness, and no Back control; this record does not say whether the contract binds the no-JS path (task 044 shipped it this way).
2. `FormDefinition` reserves an unhonored `advanceOnComplete` slot - a per-form escape from "answering never changes the rendered step". The record and the schema disagree until the Code Owner blesses or removes the slot.

### ADR-30 - Portal theming

**Status:** implemented.

**Decision.** Launch includes predefined deployment themes, brand configuration, a four-group token contract (color, typography, spacing, radius), and respondent choices for mode, font, and density. High contrast is a shared mode layer rather than a per-theme palette. The admin editor for creating and saving named custom themes is Phase 4 (task 049).

**Note.** Deployment configuration also selects a corners preset and defaults for mode, font, density, and the offered font list (`QCMS_PORTAL_*`); the decision text names only the respondent-facing half.

### ADR-31 - Answer commitment

**Status:** implemented; commit-moment rows amended and confirmed.

**Decision.** The server remains the only rule evaluator. The portal commits controls at these moments:

| Control                       | Commit moment                              |
| ----------------------------- | ------------------------------------------ |
| boolean, single choice        | on change                                  |
| short text, long text, number | on blur                                    |
| date                          | when editing ends and the date is complete |
| multi-choice                  | when focus leaves the group                |

Clearing or partially editing a previously answered date commits a retraction. Same-step visibility updates only after the relevant commit.

**Note.** Stale comments in `apps/portal/lib/visible.ts` and `apps/portal/e2e/commit-moments.pw.ts` still describe the short-text and date rows as open questions; the amendment above resolved them, and the comments should be cleaned up separately.

### ADR-39 - Link version targeting

**Status:** decided; Phase 4, not built (task 063). Today every link resolves Always latest.

**Decision.** When distributing a link, an admin picks a target policy: **Always latest** resolves the newest published version when a session starts; **Pin to version** resolves one selected published version. Existing links keep Always latest. Every session stays pinned to the version it resolved at start (ADR-07).

`/f/{slug}` is the Always latest public address; `/f/{slug}/v{version}` exists only for a published version. Pinned-address distribution state - open, redirected to Always latest, or closed with a localized explanation - lives outside the immutable snapshot. The whole-form closed state overrides every public and secure link.

Secure links keep their signed, expiring, optionally one-time model. The server-side row stores the target (Always latest or an exact version); the token format does not carry it. Public address state never governs a secure invitation. Revocation, expiry, one-time consumption, challenge checks, and abuse controls are unchanged.

**Note (flagged - live gap).** The whole-form closed state does not block secure-link entry today: the secure path in `apps/api/src/features/responses/start-session/handler.ts` never checks `form.status`, while the anonymous path does and the portal already maps `FORM_CLOSED` for `/l/{token}`. This is task 063 exit criterion 3, but it contradicts this record for a control that exists now. Also, "pinned version" already means question-version pinning (ADR-02); task 063 should choose distinct wording for link targets.
