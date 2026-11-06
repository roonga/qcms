# Admin decisions

**Status:** authoritative. Part of the decision record indexed in [`README.md`](README.md). These decisions bind only the admin. Shared decisions that also bind the admin (ADR-08, ADR-22, ADR-26, ADR-27, ADR-38 and the rest) live in [`core.md`](core.md); the operational summary is `docs/admin-constraints.md`.

---

### ADR-19 - Launch delivery split

**Status:** implemented; the CLI escape hatch is currently operative.

**Decision.** Authoring and distribution are separate delivery stages. Structured condition editing is the launch editor; a visual builder is Phase 4. The README launch loop may use documented setup if the scaffolding CLI is not ready.

**Note.** The structured editor ships with the JSON pane as an explicitly secondary, non-authoritative surface. The scaffolding CLI (task 037) is absent, so the launch loop uses documented setup, exactly as this record permits.

### ADR-25 - Agent proposes, human confirms

**Status:** implemented behind a flag that is off by default. The authoring use case shipped with task 041 and the whole action surface with tasks 080 to 083. **Amended 2026-10-19 by Code Owner ruling** (below): governed by `docs/agent-principle.md`; **launch scope and on the launch gate**. The title was "Agent-assisted authoring only" until the amendment; the number is unchanged.

**Decision.** A flag-gated admin assistant may propose questions and form drafts. The kernel validates every proposal and a human publishes it. The assistant cannot publish, erase, manage links or webhooks, or read response data. The serving path never uses an LLM.

**Note.** `QCMS_FLAG_AGENT_AUTHORING` is registered in the typed environment registry (ADR-24) and defaults to `none`, in which state the assist routes are never mounted, no panel renders, and boot requires no provider key. The three clauses that are controls rather than features are structural rather than conventional: the tool registry is module-private and frozen with a single dispatch door, the turn's context object carries no publish call and no answer reader, and the serving path takes no dependency on any of it. Quality is the part no gate in this repository can decide: whether the assistant proposes good questions is a human judgement against a real model, so a green ledger row means the controls hold and says nothing about how good the proposals are. The earlier text said the assistant "is built for launch"; the accurate statement of the decision is that it is in launch scope but does not gate launch.

**Amendment (Code Owner ruling, 2026-10-19).** This decision is governed by `docs/agent-principle.md`, which the Code Owner ruled is recorded in its own file rather than in this record; it supersedes the Decision's sentence "The assistant cannot publish, erase, manage links or webhooks, or read response data", and the Note's last sentence, since the agent is now launch scope and on the launch gate.
The design, the screen inventory, the decided defaults and the phasing are in `plan/agent-everywhere.md`, the control is SEC-17 in `docs/SECURITY_DESIGN.md`, and the shipped surface is the whole of it: the assistant is on every authenticated screen and may propose any act the signed-in user can perform from one, alone as a card or as a step of one plan, which `docs/agent-authoring.md` section 4 describes.

**Amendment (Code Owner ruling, 2026-11-06, issue #1229).** The screen is **context, not a permission list**. Until this ruling the tool set and the offered action kinds came from a per-screen registry, so a user was told "this screen cannot do X" for acts their own role allowed, which contradicts `docs/agent-principle.md` point 5. Five clauses:

- **The screen supplies facts and default ids** (`formId`, `questionId`, `workspaceId`, `environment`) for a tool call's arguments. A turn may name any other subject the signed-in user can reach.
- **D1: one typed read tool per admin GET route**, each with a strict output schema that can describe no respondent content, and ids that default to the screen's. There is no generic GET passthrough. The vocabulary walk and the sentinel walk cover every tool.
- **D2: the no-mixing rule is a `propose_plan` rule, independent of screen.** One plan may not mix authoring kinds with kinds acting on one environment's operational state, because one Confirm covers one context. Which family a kind belongs to is derived from its own screen rather than listed.
- **D3: the draft-pin binding applies only to a plan containing `form.publish`.** Each preceding `question.publish` must then be an unpublished pin of that form's saved draft, and the plan binds that draft's revision. A plan with no `form.publish` may publish any version the user may publish.
- **One screen dependency survives, and only one:** a `local` kind is run by its own screen's client-side save, so `apply-draft` and the two tools that stage for it (`propose_questions`, `propose_draft`) are offered on the form builder alone. Everywhere else the equivalent is a plan of `question.create` steps and one `form.saveDraft`.

**`form.saveDraft` (Code Owner ruling, 2026-11-06).** A new authoring kind that saves a complete draft through the route every other edit takes (`PUT /admin/forms/{id}/draft`, with the sticky agent-assisted mark), proposable from any screen, whose `formId` may name an earlier step's result. One card can therefore be `form.create`, then a `question.create` per new question, then `form.saveDraft` pinning them; publishing stays a separate card. Its draft argument is bound by the step's argument digest, excluding the `formId` the create step mints, and the card shows the server's own validation of it. The draft is validated against the question versions the plan's own earlier steps write, so a plan may repair a pinned question and change the draft under one Confirm.
