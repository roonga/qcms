# The agent principle

**Status:** authoritative · **Ruled by:** Code Owner, 2026-10-19, amended 2026-11-13 · **Applies to:** the admin assistant on every screen

This file is the one place the principle governing the admin assistant is stated. Decision records, designs and code cite it rather than restate it, so a change to the principle is a change to this file. Where an older statement says otherwise, this file governs: ADR-25's title ("Agent-assisted authoring only") and its list of things the assistant cannot do, the server-side allowlist in `docs/SECURITY_DESIGN.md` §8 (prompt injection), and "agents may assist _authoring_" in Project Goal §8. Those statements are being updated to point here (#1068).

## The principle

**The agent can do anything the signed-in user is allowed to do, with a human in the loop. It cannot read respondent responses.**

## What it means

1. **Same role, same permissions.** The agent acts as the signed-in user and never as anyone else. Whatever that user may do, the agent may propose; whatever that user may not do, the agent may not propose. For a read-only user the agent cannot write, and does not offer to.
2. **Human in the loop.** The agent proposes; a person confirms. Nothing changes until the user presses Confirm, and the confirmed action is authorized as the user and audited as the user's action. The agent never executes on its own. One class is narrower: in the agent builder, an edit to the open draft takes no per-edit Confirm, because it is reversible through Undo, and is bounded instead as the next section states (decided, not built; tasks 111 to 115).
3. **One plan, one Confirm.** A request that takes several actions is shown as one plan listing every step in order. One Confirm runs the steps in sequence, stops at the first failure and reports what ran. Each step is still authorized as the user and audited on its own.
4. **No respondent responses.** The agent never receives answer values, the answer ledger, or webhook payloads (which carry answers). Response metadata is allowed: session ids, started and submitted times, form version, access type, flag status and reason, counts, the erasure log (which holds no answers) and delivery status. That is enough to find a submission and propose an action on it without reading what the respondent said.
5. **Everywhere.** The assistant is available on every admin screen, and the principle is the same on all of them. There is no separate list of permitted or forbidden actions to maintain: the user's own permissions are the list.

## How the code implements point 5 (Code Owner, 2026-11-06, issue #1229)

Point 5 said the user's own permissions are the list, and the code did not do that: the tool
set and the offered action kinds came from a per-screen registry. Five rulings close the gap,
and ADR-25 carries them as an amendment.

1. **The screen is context.** It supplies the facts and the default subject ids a tool call
   takes when it names none. A turn may name any other subject the user can reach.
2. **One typed read tool per admin GET route**, each with a strict output schema that cannot
   describe respondent content. No generic passthrough.
3. **One plan, one context.** A plan may not mix authoring kinds with kinds acting on one
   environment's operational state. The partition is derived from each kind's own screen.
4. **The draft-pin binding is for a publishing plan.** Only a plan containing `form.publish`
   is checked against the saved draft's unpublished pins and bound to its revision.
5. **One screen dependency remains.** `apply-draft` is run by the form builder's own save, so
   it and the two tools that stage for it exist there alone. From anywhere else the same work
   is a plan of `question.create` steps and one `form.saveDraft`.

Nothing in point 4 moves: the read tools added for point 2 reach form and question structure,
release and environment state, links, endpoint configuration and delivery state, workspaces,
members, access groups and the erasure log, and not one of them can return an answer value,
the answer ledger or a webhook payload.

## Draft-scoped edits in the agent builder (Code Owner, 2026-11-13 and 2026-11-14, agent-builder Q14 to Q17 and Q22)

**Decided, not built; tasks 111 to 115.** Point 2's Confirm is for acts that cannot be taken back. The agent builder (`plan/agent-builder-decisions.md`) narrows it for one class and keeps it for everything else. SEC-17 in `docs/SECURITY_DESIGN.md` states the controls.

1. **Draft edits take no card.** An edit to the open draft in the builder applies without a per-edit Confirm, because the draft is released nowhere and Undo reverses it. It still runs from the user's browser, never from the agent's turn, through the single draft save path, bound to a token and the draft's revision, capped per turn, and writes one audit row; each Undo writes its own. The publish wizard shows the cumulative agent diff since the last human-reviewed revision, so the human publishing still sees every agent change. Only edits through `PUT /admin/forms/{id}/draft` are card-less: a write that creates or changes a library version, a new or edited question in the shared library, keeps its Confirm card through `question.create` or another library kind, because an unpublished library version persists until deprecated and Undo does not reverse it (Q22).
2. **Creating a form is a Confirm card** showing the workspace and the slug, because the slug is permanent. It needs Edit forms in that workspace.
3. **Publishing is the wizard's.** The agent may open the standard publish wizard with no card, since the wizard is the confirmation, and never executes a publish. The builder has no publish, release, link or webhook action kind, and the open-wizard tool is offered only to a Publish forms holder.
4. **The builder's conversation is the tab's.** It is its own `sessionStorage` entry, bound to the user and keyed by workspace and form, cleared at sign-out with the dock's, and never stored on the server.

Point 1 and point 4 do not move: a draft edit is authorised as the user, exactly as the user's own save is, and nothing in the builder reads an answer value.

## Limits

- The serving path never uses an LLM. Respondents never meet the agent (Project Goal §8).
- The agent is optional and flag-gated (ADR-24, ADR-25); a deployment that does not enable it has none of this.
- The agent gains no capability the signed-in user lacks. The fixed allowlist that ADR-25 and `docs/SECURITY_DESIGN.md` describe is replaced, by design, with the user's own permissions: every confirmed action is authorized as the user, exactly as the user's own clicks are, and no action runs without Confirm except a draft-scoped edit in the agent builder, which Undo reverses (decided, not built; tasks 111 to 115).
