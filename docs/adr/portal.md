# Portal decisions

**Status:** authoritative. Part of the decision record indexed in [`README.md`](README.md). These decisions bind only the respondent portal. Shared decisions that also bind the portal (ADR-08, ADR-22, ADR-26, ADR-27, ADR-38 and the rest) live in [`core.md`](core.md); the operational summary is `docs/portal-constraints.md`.

---

### ADR-12 - Accessible abuse controls

**Status:** implemented; see note.

**Decision.** Rate limits, session binding, honeypots, and timing checks are the baseline. A typed challenge-provider adapter is optional and off by default. Visible challenges are not the default.

**Note.** The API-side Turnstile verifier is still a fail-closed stub (task 029 remainder): the portal widget, CSP allowance, and config validation exist, but with a provider configured, verification cannot yet succeed. The `RATE_ANOMALY` flag reason is reserved and never produced.

### ADR-28 - Explicit portal navigation

**Status:** implemented; amended 2026-08-31 (issue #725).

**Decision.** Continue advances only after current-step validation, Back returns to the previous visible step and is hidden on the first step, and Submit appears only on the last visible step. Answering never changes the rendered step by itself.

**Amendment - the contract binds the hydrated path, and the slot is gone (Code Owner, 2026-08-31, issue #725).** The two edges the earlier note left open are settled:

1. The navigation contract above binds the **hydrated** path. The no-JS fallback's single readiness-labelled button, with no Back control, is the accepted shape by design (task 044) rather than a shortfall against the contract. Without script there is no per-step validation round trip to gate a Continue on, so one button whose label follows overall submit-readiness is the honest control to render.
2. The `advanceOnComplete` slot is **removed**. `FormDefinition` no longer reserves it, so "answering never changes the rendered step by itself" has no per-form escape and the schema and this record agree. Auto-advance is demand-gated: it returns as a decision with a behavior behind it, not as a reserved key nothing honors. Nothing carried the field - no fixture, golden document, seed, or admin or portal source - and `FormDefinition` strips unknown keys rather than rejecting them, so stored content that somehow held it still parses.

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

**Note.** The comments in `apps/portal/lib/visible.ts` and `apps/portal/e2e/commit-moments.pw.ts` used to describe the short-text and date rows as open questions after the amendment above had already settled them. They now state the settled rule (issue #725): short text commits on blur, like the other free-entry rows, and a date commits when editing ends and the date is complete, so a partial date never posts and a complete one posts exactly once.

**Note.** A retraction is posted only when the control holds an answer the record shows the server has (issue #168, Code Owner decision 2026-09-02). This is not a new commit moment and no row above changes: it states the rule every row already presupposes, since "clearing a previously answered control" cannot describe a control that was never answered. It now applies at all four moments rather than at the date's alone, so focus entering and leaving a never-answered control posts nothing.

### ADR-39 - Link version targeting

**Status:** decided; Phase 4, not built (task 063). Today every link resolves Always latest.

**Decision.** When distributing a link, an admin picks a target policy: **Always latest** resolves the newest published version when a session starts; **Pin to version** resolves one selected published version. Existing links keep Always latest. Every session stays pinned to the version it resolved at start (ADR-07).

`/f/{slug}` is the Always latest public address; `/f/{slug}/v{version}` exists only for a published version. Pinned-address distribution state - open, redirected to Always latest, or closed with a localized explanation - lives outside the immutable snapshot. The whole-form closed state overrides every public and secure link.

Secure links keep their signed, expiring, optionally one-time model. The server-side row stores the target (Always latest or an exact version); the token format does not carry it. Public address state never governs a secure invitation. Revocation, expiry, one-time consumption, challenge checks, and abuse controls are unchanged.

**Note.** The live gap this note recorded is closed (issue #724, PR #742): the secure path in `apps/api/src/features/responses/start-session/handler.ts` now checks `form.status` after the link's own state and before anything is spent, so a closed form refuses secure-link entry without consuming a one-time link or charging a challenge, exactly as this record says. What remains is wording, not behavior: "pinned version" already means question-version pinning (ADR-02), so task 063 should choose distinct wording for link targets.
