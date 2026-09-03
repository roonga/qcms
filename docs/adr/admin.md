# Admin decisions

**Status:** authoritative. Part of the decision record indexed in [`README.md`](README.md). These decisions bind only the admin. Shared decisions that also bind the admin (ADR-08, ADR-22, ADR-26, ADR-27, ADR-38 and the rest) live in [`core.md`](core.md); the operational summary is `docs/admin-constraints.md`.

---

### ADR-19 - Launch delivery split

**Status:** implemented; the CLI escape hatch is currently operative.

**Decision.** Authoring and distribution are separate delivery stages. Structured condition editing is the launch editor; a visual builder is Phase 4. The README launch loop may use documented setup if the scaffolding CLI is not ready.

**Note.** The structured editor ships with the JSON pane as an explicitly secondary, non-authoritative surface. The scaffolding CLI (task 037) is absent, so the launch loop uses documented setup, exactly as this record permits.

### ADR-25 - Agent-assisted authoring only

**Status:** implemented behind a flag that is off by default (task 041); launch scope, off the launch gate.

**Decision.** A flag-gated admin assistant may propose questions and form drafts. The kernel validates every proposal and a human publishes it. The assistant cannot publish, erase, manage links or webhooks, or read response data. The serving path never uses an LLM.

**Note.** `QCMS_FLAG_AGENT_AUTHORING` is registered in the typed environment registry (ADR-24) and defaults to `none`, in which state the assist routes are never mounted, no panel renders, and boot requires no provider key. The three clauses that are controls rather than features are structural rather than conventional: the tool registry is module-private and frozen with a single dispatch door, the turn's context object carries no publish call and no answer reader, and the serving path takes no dependency on any of it. Quality is the part no gate in this repository can decide: whether the assistant proposes good questions is a human judgement against a real model, so a green ledger row means the controls hold and says nothing about how good the proposals are. The earlier text said the assistant "is built for launch"; the accurate statement of the decision is that it is in launch scope but does not gate launch.
