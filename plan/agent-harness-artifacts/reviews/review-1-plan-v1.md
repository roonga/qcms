# Independent review 1: first QCMS harness learning plan

Read-only review of `drafts/qcms-harness-plan.html` against the repository, run before the Markdown plan existed. The findings are reproduced as delivered. File and line references point at the code as it was then and may have moved. `agent/` means `apps/api/src/features/agent/`.

**Verdict: needs changes before use.** The safety and approval half of the plan is sound, but several "mirrors the reference code" claims are wrong and the plan underteaches the harness itself.

## Factual errors and unverified claims

### Wrong or overstated

1. **Stale draft (scenario 11).** The server does not fail a stale confirm for `form.saveDraft`.
   - The draft PUT body is `{definition, agentAssisted}` with no revision (`apps/api/src/features/forms/schema.ts:76-82`), and the handler saves unconditionally (`forms/handler.ts:745-763`).
   - The token binds `draftRevision` only for plans that publish both a question and the form (`agent/tools/propose.ts:778-807`). `agent/README.md:400-402` says "an ordinary plan is not refused by a draft save".
   - The only other stale checks are at turn start on the builder route (`agent/handler.ts:513`, optional `clientState`) and at publish (`STALE_REVIEW`).
2. **Audit contents.** The audit row holds proposal id, step index and count, actor, workspace, environment, form id, kind, screen, timestamps and a non-content `detail` (`packages/db/src/schema/control/agent-actions.ts:18-44`, `agent/audit.ts:52-65`).
   - It has no prompt version, tools offered, tool calls or plan.
   - The prompt version appears only in an app log line with no proposal id or user (`agent/assistant.ts:425-437`), so "which prompt version proposed it" is not answerable.
   - `README.md:21` defines auditability around what respondents were asked and answered, not around prompts.
3. **"The agent can never publish" and "publish tool not offered".** There is no publish tool for anyone. Publish is an action kind the model proposes inside `propose_plan` (`agent/system-prompt.ts:168-186`; `fake-model.ts:920-925` puts `form.publish`, `form.release` and `form.settings` on one card).
   - A kind the user lacks is removed from the propose schema (`agent/tools/registry.ts:1073,1084`) and refused with a reason returned to the model (`propose.ts:475-490`). That is not a REFUSED turn.
   - "Publishing is always a separate card" is prompt guidance (`system-prompt.ts:101`), enforced by the server only for revision-bound plans (`propose.ts:389-423`).
4. **Roles.** The real roles are `forms.viewer`, `forms.editor`, `forms.approver`, `forms.owner`, `responses.viewer` and `responses.eraser` (`membership/policy.ts:104-129`).
   - There is no "publisher", and `forms.editor` already holds `form: publish` (`policy.ts:59-65`).
   - Grants are scoped per environment and per form, which a flat three-role model drops.
5. **"Mirrors `grant-filter.ts`".** That file filters action kinds per environment for the propose schemas (`agent/grant-filter.ts:1-5,81-99`). The tool list is filtered by each tool's permission cell and re-checked at dispatch and per subject (`registry.ts:1129-1140,1166-1178`). The plan collapsed these layers into one.
6. **"Kernel validates every step".** Core validates neither plans nor steps.
   - Question checks run through `checkQuestionDefinition` in the API app (`questions/create.ts:77`), which adds checks the kernel deliberately lacks (`agent/README.md:357-361`).
   - Draft checks run through `validateDraft` in the API app (`forms/handler.ts:404-457`), which wraps core's `compileDraft` with database lookups.
7. **Context task contradicts the wholesale-save rule.** The reference code neither truncates nor summarizes. The conversation is capped at 40 turns of 8,000 characters (`agent/schema.ts:6-9,108-112`), and `read_form` returns the complete draft precisely because a save replaces it wholesale (`agent/README.md:149-153`). "Truncate large form definitions" plus "send the whole draft back" is silent data loss.
8. **"Idempotent confirm".** The reference code is single-use. A replayed step is refused with `AGENT_PROPOSAL_ORDER` (`agent/provenance.ts:176`), backed by a unique constraint (`agent-actions.ts:43`).
9. **"Harness runs it as that user".** The assistant runs nothing. The admin client sends each step to the ordinary route with a signed token header (`apps/admin/lib/server/agent-proposal.ts:3-17`). The token binds user, step order, argument digest and environment, with a 10-minute lifetime (`agent/proposal-token.ts:11,22-38`).
10. **Tool-result framing.** Tool results are a `{framing, result}` envelope, not a fenced block (`registry.ts:1142-1156`); only screen facts are fenced (`assistant.ts:96-115`). The code calls framing "a mitigation, not a control" (`agent/README.md:175-176`).
11. **Pre-release.** `README.md:5-7` says the project is pre-release and not ready for production use.

### Importing `@roonga/qcms-core`

- It was not on the public npm registry (404 at review time).
- `packages/core/package.json:3-9` shows version `0.0.0`, `private: false`, and a description containing "placeholder". `main` points at `dist` (lines 11-18), which is not built in a fresh checkout. No publish workflow was found.
- It is usable only by building locally and using `file:`, a link or a packed tarball, pinned to a commit. Its only dependency is zod 4.
- Useful exports: `parseQuestionDefinition`, `parseFormDefinition`, `compileDraft`, `analyzeRuleGraph`, `checkRuleTypes`, `evaluateRules`, `checkSafePattern` (`packages/core/src/index.ts:81-200`).
- A sandbox must reimplement question-version lookup, pending versions and expected-pin filtering (`propose.ts:661-666`).

### Verified as stated

- README immutability and determinism (`README.md:19-20`).
- Tool and step names, including the `fromStep`/`field` reference.
- REFUSED and `stopOnRejectedTool` (`assistant.ts:293-332,446-459`).
- Step limit, default 8 (`config.ts:821`).
- Mixed-plan refusal (`propose.ts:814-823`).
- Wholesale save (`system-prompt.ts:117-121`).
- No respondent answers, enforced structurally (`agent/README.md:85-91`).
- Prompt version 16 logged per turn; token counts logged, never reasoning text.
- `fake-model.ts` runs in the real loop.

## Top 5 problems with the plan

1. **The loop itself is barely taught.** Week 1 is a non-streaming loop; the hard part of the reference code is the stream event mapping (`assistant.ts:271-320`).
   - Fix: add a phase for parsing the provider's SSE, assembling tool arguments from deltas, handling malformed arguments and every stop reason, abort, and retry with backoff.
   - Add a second provider adapter to force a neutral message model.
2. **The domain is short-horizon.** Tasks finish within 8 steps, so compaction, drift and loop detection never arise, and four of six phases are application security the reference code already designed.
   - Fix: add one long task, such as migrating a 60-question paper form while reusing library questions.
3. **"Mirror" risks copying, and the mirror was inaccurate.**
   - Fix: write your own design for each phase before reading the reference code, then diff.
   - Record the divergences above as deliberate.
   - Implement the signed token; without it, confirm is not bound to what the card showed.
4. **Context and state were one contradictory checkbox.**
   - Fix: replace it with token budgeting, eviction of old read results with a forced re-read before save, measured prompt caching (the reference code keeps the prefix stable, `system-prompt.ts:39`), and a persisted, resumable session that feeds action results back (`assistant.ts:140-155`).
5. **The last phase was overloaded and the fake model arrived too late.**
   - Fix: build the fake model and a transcript log in week 1.
   - Separate deterministic harness tests from live-model evals, which need repeated trials and pass-rate thresholds.
   - Expect roughly 8 weeks part-time once the fixes are added; the permissions phase alone is about two days.

## Missing harness concerns

- Streaming and partial tool-call JSON
- Cancellation without orphaned tool calls in history
- Retries, rate limits and timeouts
- Parallel tool calls
- Tool-argument parse and schema failures
- Stop-reason mapping (`assistant.ts:385-410`)
- Tool-schema portability: the recursive `Condition` schema already breaks some providers (`agent/tools/tool-schema.ts:1-5`)
- Provider abstraction
- Prompt caching
- Compaction and session persistence
- Reasoning-block handling
- Cost controls: per-user rate limit, token budget
- Tracing

## Scenario list feedback

- **Deterministic and good:** 9, 10, 11, and the rejection halves of 7 and 8.
- **Model behavior, not harness:** 1, 2, 3, 5, 6, and the "agent says so" or "agent splits or corrects" halves of 4, 7 and 8. A scripted model makes these tautological; a live model makes them probabilistic.
- **Scenario 5 is backwards.** The reference tests script the model to obey the injection and assert the card shows true arguments and nothing runs (`fake-model.ts:1029-1036`, `actions.integration.test.ts:464-497`).
- **Scenario 6 is trivial** unless a sentinel answer is seeded and asserted absent from every tool output.
- **Scenario 3 should be enforced by the harness:** show a diff on the card so a dropped rule is visible.
- **Missing scenarios:**
  - step-limit versus no-proposal versus output-length endings
  - provider error after a tool call
  - malformed arguments recovered
  - two proposals in one turn
  - arguments tampered between card and confirm
  - confirm by another user
  - expired proposal
  - step 2 fails and step 3 is not run
  - bad `fromStep` reference
  - reused question id
  - cancel mid-stream
  - permission revoked before confirm

## Interview value

- **Honest claim:** a tool-calling loop against the raw provider API for a propose, validate, confirm workflow with permission-scoped tools and a scripted-model test suite, compared with the AI SDK implementation in a pre-release open-source project.
- **Not honest as written:** "a kernel validates every plan" and "production".
- **Probes the plan left unprepared:** streaming internals, context overflow and compaction, caching economics, parallel tools, long-running or resumable runs, sandboxing of tools with real side effects, eval methodology and variance, and "why not just use the SDK?".
