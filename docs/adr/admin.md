# Admin decisions

**Status:** authoritative. Part of the decision record indexed in [`README.md`](README.md). These decisions bind only the admin. Shared decisions that also bind the admin (ADR-08, ADR-22, ADR-26, ADR-27, ADR-38 and the rest) live in [`core.md`](core.md); the operational summary is `docs/admin-constraints.md`.

---

### ADR-19 - Launch delivery split

**Status:** implemented; the CLI escape hatch is currently operative.

**Decision.** Authoring and distribution are separate delivery stages. Structured condition editing is the launch editor; a visual builder is Phase 4. The README launch loop may use documented setup if the scaffolding CLI is not ready.

**Note.** The structured editor ships with the JSON pane as an explicitly secondary, non-authoritative surface. The scaffolding CLI (task 037) is absent, so the launch loop uses documented setup, exactly as this record permits.

### ADR-25 - Agent proposes, human confirms

**Status:** the authoring use case is implemented behind a flag that is off by default (task 041). **Amended 2026-10-19 by Code Owner ruling** (below): governed by `docs/agent-principle.md`; decided, not built; **launch scope and on the launch gate**. The title was "Agent-assisted authoring only" until the amendment; the number is unchanged.

**Decision.** A flag-gated admin assistant may propose questions and form drafts. The kernel validates every proposal and a human publishes it. The assistant cannot publish, erase, manage links or webhooks, or read response data. The serving path never uses an LLM.

**Note.** `QCMS_FLAG_AGENT_AUTHORING` is registered in the typed environment registry (ADR-24) and defaults to `none`, in which state the assist routes are never mounted, no panel renders, and boot requires no provider key. The three clauses that are controls rather than features are structural rather than conventional: the tool registry is module-private and frozen with a single dispatch door, the turn's context object carries no publish call and no answer reader, and the serving path takes no dependency on any of it. Quality is the part no gate in this repository can decide: whether the assistant proposes good questions is a human judgement against a real model, so a green ledger row means the controls hold and says nothing about how good the proposals are. The earlier text said the assistant "is built for launch"; the accurate statement of the decision is that it is in launch scope but does not gate launch.

**Amendment (Code Owner ruling, 2026-10-19).** This decision is governed by `docs/agent-principle.md`, which the Code Owner ruled is recorded in its own file rather than in this record; it supersedes the Decision's sentence "The assistant cannot publish, erase, manage links or webhooks, or read response data", and the Note's last sentence, since the agent is now launch scope and on the launch gate.
The design, the screen inventory, the decided defaults and the phasing are in `plan/agent-everywhere.md`, the control is SEC-17 in `docs/SECURITY_DESIGN.md`, and until that design's phase D lands the shipped surface is the four authoring tools task 041 built, which `docs/agent-authoring.md` section 4 describes.
