# Admin decisions

**Status:** authoritative. Part of the decision record indexed in [`README.md`](README.md). These decisions bind only the admin. Shared decisions that also bind the admin (ADR-08, ADR-22, ADR-26, ADR-27, ADR-38 and the rest) live in [`core.md`](core.md); the operational summary is `docs/admin-constraints.md`.

---

### ADR-19 - Launch delivery split

**Status:** implemented; the CLI escape hatch is currently operative.

**Decision.** Authoring and distribution are separate delivery stages. Structured condition editing is the launch editor; a visual builder is Phase 4. The README launch loop may use documented setup if the scaffolding CLI is not ready.

**Note.** The structured editor ships with the JSON pane as an explicitly secondary, non-authoritative surface. The scaffolding CLI (task 037) is absent, so the launch loop uses documented setup, exactly as this record permits.

### ADR-25 - Agent proposes, human confirms

**Status:** the authoring use case is implemented behind a flag that is off by default (task 041); launch scope, off the launch gate. **Amended 2026-10-19 by Code Owner ruling** (below): the agent reaches every admin screen under a confirm model and a denylist; decided, not built. The title was "Agent-assisted authoring only" until the amendment; the number is unchanged.

**Decision.** A flag-gated admin assistant may propose questions and form drafts. The kernel validates every proposal and a human publishes it. The assistant cannot publish, erase, manage links or webhooks, or read response data. The serving path never uses an LLM.

**Note.** `QCMS_FLAG_AGENT_AUTHORING` is registered in the typed environment registry (ADR-24) and defaults to `none`, in which state the assist routes are never mounted, no panel renders, and boot requires no provider key. The three clauses that are controls rather than features are structural rather than conventional: the tool registry is module-private and frozen with a single dispatch door, the turn's context object carries no publish call and no answer reader, and the serving path takes no dependency on any of it. Quality is the part no gate in this repository can decide: whether the assistant proposes good questions is a human judgement against a real model, so a green ledger row means the controls hold and says nothing about how good the proposals are. The earlier text said the assistant "is built for launch"; the accurate statement of the decision is that it is in launch scope but does not gate launch.

**Amendment - the agent on every admin screen, under a confirm model and a denylist (Code Owner ruling, 2026-10-19).**
This is the ruling, recorded as made.
It **supersedes the Decision's sentence "The assistant cannot publish, erase, manage links or webhooks, or read response data"** and replaces it with the five points below.
The rest of the Decision stands: the kernel validates every authoring proposal, and the serving path never uses an LLM.

1. **Every admin screen, with exceptions.** The form builder was the first use case and not the scope. The agent is available on every authenticated admin screen, through a floating launcher and a floating or dockable panel, with visibly streamed responses and visible thinking.
2. **Propose, human confirms.** Every agent action is a card naming the act (for example "Release v3 to test") with Confirm and Cancel. It runs only on Confirm, with the signed-in user's own permissions, through the same server action and the same audit trail as the screen's own control, and the audit trail marks it as agent-proposed and human-confirmed. The agent can never exceed the user.
3. **No respondent data.** On response screens the agent works with structure and counts only (filters, counts, export settings), never answer values. No respondent data reaches the model provider.
4. **Never proposable, even with confirmation**, and enforced server-side rather than only absent from the UI:
   - account and sign-in security: password, 2FA, recovery codes, sessions;
   - erasing respondent data;
   - members, roles and workspace ownership;
   - webhook secrets and targets: rotating a secret, retargeting, and creating an endpoint, which sets a URL;
   - release or rollback to `prod`.
5. **What stays structural.** The agent's turn executes nothing: it reads what the screen shows and proposes; execution is a separate request a human makes by pressing Confirm. The tool registry stays module-private and frozen with a single dispatch door, now scoped per screen.

**What this amendment does not decide.** The architecture that implements the ruling, the draft control SEC-17 in `docs/SECURITY_DESIGN.md`, the phasing, and twenty open questions (among them prod close and reopen, prod link minting, webhook redelivery, access groups, workspace settings and the agent audit's readers) are in `plan/agent-everywhere.md` and await their own rulings.
Until phase D of that plan lands, the shipped surface is the four authoring tools task 041 built, and `docs/agent-authoring.md` section 4 describes it accurately.
