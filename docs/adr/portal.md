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

**Amendment - the cursor indexes step views, not steps (Code Owner, 2026-09-30, ADR-42, ADR-43).** A repeating group whose presentation is `perInstanceStep` paginates one step into one page per live instance, so a step id no longer identifies a page. The cursor stays what it is, a **0-based index into a list the server computes**, and what it indexes becomes `visibleStepViews`, a list of `(stepId, instanceId | null)` where the instance is null for every page that is not a per-instance one. A compound cursor on the wire (`?step=3&instance=ins_7k2`) was weighed and refused, and the reason is about what a forged value can reach rather than about visibility. An instance id is already visible on this surface, in field names, DOM ids, anchors and the fragment the no-JS add lands on, so "it would put a session-scoped id in a URL" is not the argument. The argument is that **a cursor is an index into a list the server computed for this session on this request**: out of range is refused by arithmetic, and in range names a view the server had already decided was visible. A compound cursor would instead take an instance id as input and have to prove it belongs to this session, to this group and to the live roster, which is three checks where the index needs none.

Nothing else in this decision moves. Continue advances one **view**, Back returns one, Submit appears on the last, and answering never changes the rendered page by itself. `progress: {stepIndex, totalVisibleSteps}` counts views, so a three-passenger group presents as three views and the indicator says three. A form with no repeating group has one view per visible step and every number is what it is today. Decided, not built: task 076.

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

**Note - repetition changes no row in the table above (ADR-42, ADR-43, Code Owner, 2026-09-30).** A repeating group is a **layout** and not a control: every cell of a table and every field of an instance card is an ordinary question of an ordinary type, and it commits at the moment its own row names. Adding a column type to a table presentation adds no commit moment, and a group's presentation never changes one.

**Adding and removing an instance commits immediately**, which is a new action rather than a changed row. It changes state the server owns, the roster, and the server is the only rule evaluator, so there is nothing a client could defer without the page disagreeing with the flow. Without scripting the same action rides the whole-step POST as a named submit button, so the commit is the ordinary step submission. Decided, not built: task 073.

### ADR-39 - Link version targeting

**Status:** decided; Phase 4, not built (task 063). Today every link resolves Always latest.

**Decision.** When distributing a link, an admin picks a target policy: **Always latest** resolves the newest published version when a session starts; **Pin to version** resolves one selected published version. Existing links keep Always latest. Every session stays pinned to the version it resolved at start (ADR-07).

`/f/{slug}` is the Always latest public address; `/f/{slug}/v{version}` exists only for a published version. Pinned-address distribution state - open, redirected to Always latest, or closed with a localized explanation - lives outside the immutable snapshot. The whole-form closed state overrides every public and secure link.

Secure links keep their signed, expiring, optionally one-time model. The server-side row stores the target (Always latest or an exact version); the token format does not carry it. Public address state never governs a secure invitation. Revocation, expiry, one-time consumption, challenge checks, and abuse controls are unchanged.

**Note - the secure-link row also carries the environment, and a non-prod address is prefixed (ADR-40, issue #995).** The server-side row is already the place a target policy lives rather than the token, and ADR-40 puts a second field beside it: which **environment** the redeemed link starts a session in. The two are independent choices on one row - an environment and a target policy - and neither is in the signed token, so a leaked token still discloses nothing about either and revocation, expiry and one-time consumption are unchanged. Task 063 and the environments work therefore touch the same row and should agree on its shape before either lands.

The **address forms above are `prod`'s, and they keep exactly that spelling** (Code Owner, 2026-09-26). `/f/{slug}` and `/f/{slug}/v{version}` are unprefixed and prod-only; a non-prod environment has no public address at all, because there is no anonymous entry to one, so `/<env>/f/{slug}` is not a route and neither is its pinned form. What a non-prod environment does have is prefixed: its secure-link and session addresses carry the environment's name as their first path segment, so a test invitation reads `/test/l/{token}`. That prefix is legibility and a network handle, not authority: a token presented under the wrong prefix is refused, and the row still decides both the environment and the target version.

**Amendment - the closed state that overrides a link is the environment's (Code Owner, 2026-09-26, issue #995, ADR-40).** The paragraph above says "the whole-form closed state overrides every public and secure link", and under ADR-40 that becomes **the environment's** closed state overriding every link **into that environment**. Closing `prod` intake while a test run continues, and the reverse, are ordinary operations, so closed cannot be one column on the form: the per-environment release state carries the value, and `forms.status` with its `form_status` enum goes away or becomes derived from those states. Nothing else in this decision moves. The override is still absolute, a secure link still cannot enter a closed environment, and `apps/api/src/features/responses/start-session/handler.ts` still checks that state after the link's own and before anything is spent, which is what the Note above records. Tasks 063 and 066 therefore touch the same check as well as the same row, and 066 owns the state.

**Note.** The live gap this note recorded is closed (issue #724, PR #742): the secure path in `apps/api/src/features/responses/start-session/handler.ts` now checks `form.status` after the link's own state and before anything is spent, so a closed form refuses secure-link entry without consuming a one-time link or charging a challenge, exactly as this record says. What remains is wording, not behavior: "pinned version" already means question-version pinning (ADR-02), so task 063 should choose distinct wording for link targets.

### ADR-43 - Repeat rendering and the no-JS roster operation

**Status:** decided; not built (tasks 073, 076 and 077). Code Owner rulings of 2026-09-30, recorded question by question in `plan/repeating-groups-and-table-input.md` section 10. Nothing here is open. The kernel half is ADR-42.

**Decision.** The compiler emits a **`RepeatGroup` template** node carrying the group's member controls once. The renderer clones it per live instance, in roster order, and qualifies each cloned control's `name` from `q_passport` to `ins_7k2/q_passport`, so the stored compiled document is served verbatim and expansion is a render-time transform on the precedent `withNativeSubmit` and `documentForVisible` already set (ADR-18 unaffected). The **qualified name is the field's whole identity everywhere below the API**, so the ten places that key on `name` keep keying on one opaque string and none of them learns about instances. The roster reaches the renderer from the API's step projection; the portal still evaluates nothing (R2).

**Adding and removing an instance without scripting is a named submit button** on the step's own form: `<button type="submit" name="__qop" value="add:grp_passengers:op_7f3">`, with the removal form carrying the instance id. A button contributes its name and value only when it is the submitter, so one form carries several operations without scripting. The buttons carry **`formnovalidate`**: every other control on the step keeps browser validation (the 2026-09-13 ruling on issue #920), but a respondent who has filled one instance and wants a second must not be refused by the browser for a blank field in the first and told nothing.

**An Add or Remove post applies the roster operation and commits NO answers** (Code Owner, 2026-09-30). The typed values ride the post, are carried back for the re-render and reach the ledger only on Continue, under the ordinary validation an ordinary Continue does. That is what makes `formnovalidate` safe rather than merely convenient, and it is why **`docs/portal-constraints.md`'s "a required question cannot be CLEARED without scripting" bullet is unchanged**: an emptied required field on an Add post is not a retraction, because no answer write happens at all. Validation is deferred, not skipped.

**The carrier for those typed values is the POST body, so the `__qop` request re-renders in its own 200 response** rather than redirecting. Nothing else scales: the values are the whole step rather than a refused subset, and the whole step at nine instances is what does not fit in a 4 KB cookie, so capping the carriage would mean dropping answers. The cost of trading the redirect away is paid rather than hidden: the roster operation carries a **one-time operation token**, minted into the button's value and recorded with the roster row, so a reload or a Back replays nothing and re-renders the same instances. The Continue path keeps its 303 and its cookie, so exactly one path in the portal answers a POST with a page, and it is the one that committed no answers.

Field names are unique per instance; no repeated field name is relied on, because an unchecked box contributes no entry and positional zipping across columns is therefore unsafe.

**A table presentation renders a native `<table>` and never `role="grid"`.** A grid requires author code to manage focus movement inside it, so it cannot exist with scripting disabled, and this surface's no-JS claim is unqualified with an empty exception list. The table carries a caption, `<th scope="col">` per column, `<th scope="row">` per instance and **a real label on every input**, visually hidden, because header association names a cell and not the control inside it, and because the 390px card reflow takes the headers away. The documented cost is one tab stop per cell, which is the expected behaviour of the choice rather than a defect. Cells are limited to five question types (`shortText`, `number`, `date`, `boolean`, `singleChoice`); `longText` and `multiChoice` are refused at publish and the refusal names the stacked presentation.

**The stacked presentation is one input per row**: a single column inside an instance card, with no two fields side by side at any width, and **every** question type allowed. The asymmetry with the table is deliberate and is what makes the table's refusal survivable.

**Focus and announcement follow the APG.** After an add, focus lands on the new instance's heading. After a removal there are three destinations in order: the heading of the instance that **took its place**; failing that, because the removed one was last, the **previous** instance's heading; failing that, because the removed one was the **only** instance, the **Add button**, which is then the only candidate on the page. The APG covers the first; the second and third are this record's reading of its reasoning rather than its words, and the third can arise only in a group whose `min` is 0. A `role="status"` region announces the change **on the scripted path only**: without scripting a whole-page POST and re-render is a change of context, which 4.1.3 scopes out explicitly, and the landing is reached by the 303's fragment instead. No source found addresses focus after a POST-redirect-GET, so the fragment landing is a decision this record takes rather than a citation it makes, and task 030's manual screen-reader pass is where it is tested.

**Consequences.** `docs/portal-constraints.md` is updated in the same change and its **exception list stays empty**: there is still no question shape a respondent without scripting cannot answer. `A2UI_SPEC_VERSION` and `COMPILER_VERSION` move and a new golden generation opens (ADR-18). The Continue path's re-render context outgrows one cookie: `values` and `missingRequired` come from the API's own step projection, and the `qcms_step_ctx` cookie keeps the capped 422 errors. **Each capped record is `{error, constraint, value}`, and the cap is stated in fields**, because the projection holds accepted answers only and a refused value would otherwise re-render as a blank cell beside a message about what the respondent typed, which is a WCAG 3.3.7 Redundant Entry failure. Behaviour on overflow is defined rather than discovered: the first N fields are kept, the rest dropped, the re-render says some messages could not be carried, and Continue returns the full set.

**The answer endpoint gains a batch form**, because one call per answer is fifty-four sequential round trips and fifty-four advisory locks for one nine-instance Continue. It carries a Continue's answers only: the roster operation is its own post and commits no answers, so the earlier claim that the batch makes the two one transaction does not hold and is withdrawn. **The batch is rate limited per entry, not per request**, because `answersPerSessionLimiter` keys per request today and a batch would otherwise multiply a per-session allowance written for one answer by the batch size (SEC-16).

**Note - issue #968 is fixed in the same work (Code Owner, 2026-09-30, Q20).** #968 records that the required-answer sweep runs before the session lock, so a concurrent retraction can leave the ledger and the submission out of step. Repetition multiplies that window by the number of fields a step posts, and the no-JS path posts a whole step at once. The batch endpoint above is where the answer path's locking is decided, so the ruling makes closing #968 a **deliverable and an exit criterion of task 073** rather than a dependency scheduled elsewhere.

**Note - a table's tab-stop count is bounded per form and by nothing else (SEC-16).** The mitigation for one tab stop per cell is the group's `max`, and there is no installation-wide ceiling above it (ADR-42, SEC-16). A table's tab-stop count is therefore `columns x max` for whatever `max` its author declared, which makes an accessibility property an authoring decision. It is recorded here so a reviewer reads it as the ruled trade rather than as an oversight.
