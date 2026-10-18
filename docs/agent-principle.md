# The agent principle

**Status:** authoritative · **Ruled by:** Code Owner, 2026-10-19 · **Applies to:** the admin assistant on every screen

This file is the one place the principle governing the admin assistant is stated. Decision records, designs and code cite it rather than restate it, so a change to the principle is a change to this file. Where an older statement says otherwise (ADR-25's list of things the assistant cannot do, or "agent-assisted authoring only"), this file governs, and those statements are updated to point here.

## The principle

**The agent can do anything the signed-in user is allowed to do, with a human in the loop. It cannot read respondent responses.**

## What it means

1. **Same role, same permissions.** The agent acts as the signed-in user and never as anyone else. Whatever that user may do, the agent may propose; whatever that user may not do, the agent may not propose. For a read-only user the agent cannot write, and does not offer to.
2. **Human in the loop.** The agent proposes; a person confirms. Nothing changes until the user presses Confirm, and the confirmed action runs through the same server action, authorization and audit trail as the screen's own control. The agent never executes on its own.
3. **One plan, one Confirm.** A request that takes several actions is shown as one plan listing every step in order. One Confirm runs the steps in sequence, stops at the first failure and reports what ran. Each step is still authorized as the user and audited on its own.
4. **No respondent responses.** The agent never receives answer values, the answer ledger, or webhook payloads (which carry answers). Response metadata is allowed: session ids, started and submitted times, form version, access type, flag status and reason, counts, the erasure log (which holds no answers) and delivery status. That is enough to find a submission and propose an action on it without reading what the respondent said.
5. **Everywhere.** The assistant is available on every admin screen, and the principle is the same on all of them. There is no separate list of permitted or forbidden actions to maintain: the user's own permissions are the list.

## What it does not change

- The serving path never uses an LLM. Respondents never meet the agent (Project Goal §8).
- The agent is optional and flag-gated (ADR-24, ADR-25); a deployment that does not enable it has none of this.
- Nothing here relaxes any security control. The agent gains no capability the user lacks, and every action it proposes is checked by the same authorization as the user's own clicks.
