# Admin decisions

**Status:** authoritative. Part of the decision record indexed in [`README.md`](README.md). These decisions bind only the admin. Shared decisions that also bind the admin (ADR-08, ADR-22, ADR-26, ADR-27, ADR-38 and the rest) live in [`core.md`](core.md); the operational summary is `docs/admin-constraints.md`.

---

### ADR-19 - Launch delivery split

**Status:** implemented; the CLI escape hatch is currently operative.

**Decision.** Authoring and distribution are separate delivery stages. Structured condition editing is the launch editor; a visual builder is Phase 4. The README launch loop may use documented setup if the scaffolding CLI is not ready.

**Note.** The structured editor ships with the JSON pane as an explicitly secondary, non-authoritative surface. The scaffolding CLI (task 037) is absent, so the launch loop uses documented setup, exactly as this record permits.

### ADR-25 - Agent-assisted authoring only

**Status:** decided; launch scope, off the launch gate; not built (task 041).

**Decision.** A flag-gated admin assistant may propose questions and form drafts. The kernel validates every proposal and a human publishes it. The assistant cannot publish, erase, manage links or webhooks, or read response data. The serving path never uses an LLM.

**Note.** Nothing exists yet: no flag, no seam, no assistant dependency. Setting the documented `QCMS_FLAG_AGENT_AUTHORING` fails boot today, and that is ADR-24's fail-fast on an unregistered flag working as designed rather than anything to work around. Registering the flag in the typed environment registry is task 041's first step. The one verifiable clause - no LLM in the serving path - holds. The earlier text said the assistant "is built for launch"; the accurate statement of the decision is that it is in launch scope but does not gate launch.
