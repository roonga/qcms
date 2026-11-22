# Independent review 2: second QCMS harness learning plan

Read-only second-pass review of `drafts/qcms-harness-plan-v2.html`, checking the fixes for review 1 and every new claim against the repository. The findings are reproduced as delivered. File and line references point at the code as it was then and may have moved. `agent/` means `apps/api/src/features/agent/`. The page's JavaScript was read, not run in a browser.

**Verdict: not ready.** The Markdown plan in `plan/agent-harness-learning-plan.md` was written afterwards to resolve these findings.

## Fix status of the 10 original items

| #   | Status              | Remaining gap                                                                                                                     |
| --- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fixed               | Matches `agent/tools/propose.ts:773-807`.                                                                                         |
| 2   | Fixed               | Matches `packages/db/src/schema/control/agent-actions.ts:21-41` and `agent/assistant.ts:425-427`.                                 |
| 3   | Fixed               | The learner's own step list has no publish kind.                                                                                  |
| 4   | Partly              | Role names are right; the scope claim is overgeneralised, and the permissions task reads as a ladder.                             |
| 5   | Fixed               | None.                                                                                                                             |
| 6   | Fixed, with residue | Leftover changelog wording in the context phase intro.                                                                            |
| 7   | Partly              | One line still said "A human confirms each step, and the act runs as that person."                                                |
| 8   | Fixed               | Matches `agent/README.md:170-176`.                                                                                                |
| 9   | Fixed               | Date the claim: the registry returned 404 at review time, and `package.json:4-9` shows intent to publish.                         |
| 10  | Partly              | The second-provider week was overloaded, the fake model did not cover the stream parser, and one "live eval" was not a live eval. |

## New or remaining factual errors

### Wrong

| v2 wording                                                                   | Evidence                                                                                                                                                                                     | Replacement                                                                                                                                         |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Two proposals in one turn: both cards are shown"                            | `PROPOSALS_PER_TURN = 1` at `propose.ts:31`; refusal at `propose.ts:752-755`; test "shows only the first card when a turn proposes twice" at `agent/actions.integration.test.ts:386-401`     | A second propose call in a turn is refused with "put the steps in one plan"; only the first card is shown. Record any other design as a divergence. |
| "A human confirms each step, and the act runs as that person."               | One Confirm covers the plan (`agent/tools/propose-schema.ts:84`, `agent/tools/registry.ts:1079`); the token adds provenance, never rights (`agent/provenance.ts:1-4`)                        | A human confirms the plan once. Each step is then sent as that person's own authenticated request.                                                  |
| "Confirm after the 10-minute lifetime: rejected"                             | Expiry is checked on step 0 only (`agent/proposal-token.ts:10-11`, `provenance.ts:194-196`); later steps get 10 minutes from step 0's recorded confirmation (`provenance.ts:146-150`, `177`) | Step 0 after 10 minutes is expired. A later step more than 10 minutes after step 0 was confirmed is refused.                                        |
| "The recursive Condition schema already breaks some providers in production" | `agent/tools/tool-schema.ts:1-5`: LM Studio ignores zod's `definitions` block and the AI SDK's Google provider refuses the cycle; QCMS rewrites it to depth 3 (`tool-schema.ts:14`)          | QCMS rewrites the recursive Condition schema into a self-contained, depth-bounded one, because those providers could not consume the original.      |

### Imprecise

| v2 wording                                                          | Evidence                                                                                                                                                                                                                                                                                                                                                          | Replacement                                                                                                                                                 |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Signed token binds user, step order, argument digest, environment" | The payload also binds the action kind per step and the proposal id (`proposal-token.ts:16-38`); kind maps to route (`provenance.ts:203-204`); order is enforced from audit rows, not the token (`provenance.ts:168-179`)                                                                                                                                         | The token binds user, proposal id, and per step: action kind (so route), argument digest, environment. Order is enforced server-side from recorded steps.   |
| "Single use, enforced by a unique constraint"                       | The constraint exists (`agent-actions.ts:14-15`, `43`), but a normal replay is refused first by the read check (`provenance.ts:176`). The constraint only rolls back the act when the row is in the act's transaction (`forms/handler.ts:754-763`); for environment-database acts the row is written after commit (`agent/README.md:458-465`).                    | Replays are refused by the recorded-step check; a unique constraint in the act's own transaction is the backstop for races.                                 |
| "Signed, single-use token"                                          | One token per plan is sent with every step, plus a step index header (`apps/admin/lib/server/agent-proposal.ts:13-19`)                                                                                                                                                                                                                                            | The plan's signed token and a step index; each step can be recorded once.                                                                                   |
| "Two separate layers" of permission checks                          | There are four: tool list by cell (`agent/handler.ts:214-229`), kind and environment offer (`agent/grant-filter.ts:81-99`), per-subject checks at propose time (`propose.ts:284-309`), and the route's grant check at confirm (`apps/api/src/registrars.ts:40-43`). Only `environmentFrom: "argument"` kinds get an environment enum (`propose-schema.ts:19-28`). | Four checks: offered tools, offered kinds (with an environment list for kinds that take one), per-subject checks at propose time, and the route at confirm. |
| "Per environment and per form" grants                               | Scope lives on each grant (`apps/api/src/features/membership/policy.ts:178-185`). Environment scope applies only to nine acts (`policy.ts:141-151`), and form scope only to `response:*` (`policy.ts:154-159`). `forms.owner` cannot author (`policy.ts:78-84`); `forms.approver` cannot write or publish (`policy.ts:67-76`).                                    | Six roles in two families, not a ladder. Authoring is workspace-wide; environment scope applies to live-state acts, form scope to response acts.            |
| "Caps the conversation at a number of turns and characters"         | 40 turns (`agent/schema.ts:108-112`), 8,000 characters per turn (`schema.ts:6-9`), no total size cap. The client resends history; there is no server session, and earlier tool results are not replayed (`assistant.ts:119-155`).                                                                                                                                 | At most 40 turns of at most 8,000 characters each, resent by the client. No server session, no token budget.                                                |
| Stale-draft divergence row                                          | Two other guards exist: the builder route refuses a stale `clientState` (`handler.ts:513-515`), and `form.publish` carries the draft revision through the batch route (`agent/README.md:413-419`)                                                                                                                                                                 | Add both to the "reference code does" column.                                                                                                               |

### Verified correct

- An unoffered tool ends the turn as REFUSED and stops spend: `assistant.ts:293-300`, `327-332`, `446-458`.
- Three distinct error codes: `assistant.ts:385-410`.
- Mixed plans rejected: `propose.ts:809-823`, `agent/screens.ts:123-125`.
- The route re-checks permissions: the provenance check is mounted after the grant check (`registrars.ts:40-43`).
- A failed step stops later steps, enforced by both sides. The server refuses step i unless steps 0 to i-1 are recorded (`provenance.ts:168-175`), and the client stops sending (`apps/admin/lib/agent/plan-state.ts:125-129`). A test should send step 3 directly after step 2 fails, or it only tests the client.
- All six listed core exports exist in `packages/core/src/index.ts` (lines 106, 136, 137, 164, 175, 199).
- Tool-result framing and loop rows: `registry.ts:1142-1156`, `assistant.ts:347`.

### Not verified

"A reused question keeps its answer history comparable across forms." One narrow search of the repository's Markdown found nothing; confirm or soften.

### Uses of the word "production"

Nine occurrences broke the plan's own rule that QCMS is pre-release. Use "QCMS" or "the reference code".

## Consistency and feasibility problems

1. **Design-first was undermined by the plan itself.** The workflow section, divergence table and approval tasks already gave the design. Either move reference-code detail into a "compare after building" block per phase, or change the claim to "re-implemented and extended a known design".
2. **No phase built the application layer.** A database with constraints, HTTP routes with permission checks, a user identity stub and a card UI were all missing. Add it before the approval phase, and name SQLite in week 1.
3. **Tests and evals referred to things no phase built.**
   - No publish kind, so "nothing published" and the publish-grant eval could not fail.
   - No operational kind, so the mixed-plan test had nothing to mix.
   - No response store or count tool, so the sentinel test and "offers counts and metadata" had nothing to test.
   - Parallel tool calls had no task.
   - No task wrote or versioned the system prompt.
4. **The permissions phase was partly vacuous.** All three planned kinds are workspace-wide (`agent/actions/forms-library.ts:42-46`, `agent/actions/questions.ts:71-75`, `agent/actions/forms.ts:101-105`). Per-environment filtering only bites once `form.publish` or `form.close` exists.
5. **The deterministic tests did not cover the stream layer.**
   - A scripted model at the adapter interface skips the SSE parser and delta assembly. Add recorded byte-level stream fixtures per provider, including splits mid-event.
   - Inject a clock (as `agent/provenance-mount.ts:148-151` does) and an id generator, and canonicalise JSON before digesting (`proposal-token.ts:74-93`).
   - "Tool schemas one provider rejects" needs a real provider, so it is a contract test and belongs in neither table.
6. **Live evals needed work.**
   - "Model writes an invalid condition operator" cannot be requested from a real model. Make it a scripted test, or measure recovery rate on a task that tends to cause it.
   - "Compaction used" is a mechanism, not a pass criterion.
   - "Valid draft" must allow unpublished pins for questions the plan creates (`propose.ts:656-666`).
   - Evals need a scripted approver and named graders.
   - Ten trials cannot detect a small improvement; use 30 or more on the key tasks, with paired comparison.
7. **The 60-question task conflicts with wholesale save.** The model must emit the whole draft in one call, which runs into output limits, and QCMS caps a plan at 25 steps (`proposal-token.ts:13`). Decide on a patch-style tool, applied by the harness to a fresh read, and record it as a divergence.
8. **Smaller contradictions.**
   - The divergence table replaced caps with token budgeting, while a later phase added caps.
   - Crash resume appeared in two phases.
   - Eviction and compaction break the byte-stable prefix that the caching task measures.
   - "Offered tool names" belong on a turn record, because the step row is written at confirm, which knows nothing about the turn.
9. **Timeline.** The reviewer's estimate was 11 to 13 weeks at 8 to 10 hours a week, not 8.
   - Too big: the second-provider week, the approval phase, and the context and long-task phases.
   - Light: the permissions phase.
   - Tracing belongs in week 2, not week 8.
10. **Interview block.** "Fails halfway" is only supported if the approval phase adds per-step outcomes (done, failed, not-run) and the act-plus-record transaction. Say whether you contributed to QCMS; an interviewer will ask.
11. **Still missing.** Reasoning-block handling on raw APIs, tool output size limits, and SSE keep-alive with client-disconnect abort.

## HTML and JavaScript bugs

No broken markup, unescaped characters or syntax errors were found. The checkboxes, progress bar, reset and persistence should work.

- **Null state crash.** A stored value of `null` makes the later `saved[...]` read throw, leaving the page unbound. After the `try`, add `if (!saved || typeof saved !== "object") saved = {};`.
- **Positional ids.** `data-id="${pi}-${ti}"` means any task edit remaps saved ticks. Give each task a stable id, or bump the storage key on every edit.
- **Progress bar is invisible to assistive technology.** Add `role="progressbar"` with `aria-valuemin`, `aria-valuemax` and `aria-valuenow`, and `aria-live="polite"` on the count.
- **Contrast below 4.5:1.** `.tag` is about 4.2, `.num` about 3.6, and `.phase.done .num` and `.col.harness h3` about 4.3. Darken the accent and green tokens.
- **Minor.** Reset has no confirmation; the `summary` focus ring is clipped by `overflow: hidden`; `th` cells lack `scope="col"`; tables have no horizontal scroll wrapper on narrow screens; there is no `noscript` fallback.

## Verdict

Not ready. Required before use: fix the four wrong claims and remove the "production" uses; add the application layer, a publish kind, an operational kind and a response store; resolve the design-first contradiction; add stream fixtures and an injected clock; re-plan to about 12 weeks, or cut the second provider and shrink the long task. The imprecise wording and the HTML fixes can follow.
