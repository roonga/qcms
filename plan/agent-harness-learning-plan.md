# QCMS Harness Sandbox: Implementation Plan

Reference code: QCMS at commit `25da69b` (2026-11-12), read-only. Plan written 2026-11-23.
"QCMS" and "the reference code" mean that repository. Its README says it is pre-release and "not ready for production use" (`README.md:5-7`), so nothing here treats it as a live system.

## How to use this plan

For every phase, in this order: (1) write the design paragraph in `docs/design/NN.md` and commit it, (2) build the tasks, (3) make the named tests pass, (4) run the demo, (5) only then open the phase's **Compare after building** block and write the divergence entries.

- **Spoilers.** Every Compare block, section 7 (each row says after which phase to read it) and section 11 describe the reference code. Do not read them early.
- **Section 4 is the sandbox's own default design.** You may change it in a design paragraph; if you do, update the acceptance criteria you touch.
- **Each phase has a 2-minute demo.** If you cannot run it, the phase is not done.

---

## 1. Goal and honest claim

**Goal.** Build, by hand, the runtime around a model for an assistant that helps administrators author questionnaires with conditional logic: agent loop, streaming, tool execution, permissions, human confirmation with provenance, context management, sessions, audit, and evaluation.

**What you will be able to say afterwards** (each clause is backed by a phase and a test you can show):

> "I built an LLM agent harness from scratch in TypeScript against the raw Anthropic Messages API, with no agent framework: my own SSE parser and tool loop, permission-filtered tools, a propose-then-confirm flow where a signed token binds each step's route, arguments and environment, context eviction that never truncates data the model must send back, content-free turn records, and an eval suite split into deterministic tests, provider contract tests and live evals with paired comparison. I then compared each part against an open-source, pre-release system (QCMS) and kept a log of where my design differs and why."

**What you must NOT claim.**

- That the sandbox ran in production, served real users, or handled real respondent data. It is a learning sandbox with an identity stub.
- That you built QCMS's assistant, or that your code is in QCMS. The reference loop uses the AI SDK's `streamText`; yours does not.
- That prompt-injection framing is a security control, or that the sandbox passed a security review.
- That live-eval numbers generalise beyond the tasks, model id and date in the report, or that a difference smaller than your measured noise is an improvement.
- Expertise in the AI SDK, LangChain or similar. You compared against one; you did not build on one.
- Anything a cut-line removed (section 8 lists the claim each cut costs).

**The contribution question.** Interviewers will ask "did you work on QCMS?". Write the true sentence now and keep it in the sandbox README. Pick the one that applies:

- "No. I read it as a reference and contributed nothing to it." (Its README says external pull requests are not accepted yet, `README.md:139`.)
- "Yes, in this way: ___ (for example: I direct an agentic workflow that builds it; I did not hand-write its agent loop). The sandbox is the part I wrote by hand."

**Dependency honesty.** If the QCMS kernel validates your drafts (Phase 0), say so: "validation comes from QCMS's MIT-licensed kernel, which I did not write; the harness around it is mine."

---

## 2. Architecture overview

```
  CLI: chat, card, confirm runner             Eval runner: tasks, scripted approver, graders
      |  HTTP + SSE                                |  same HTTP surface, fresh SQLite file per trial
      v                                            v
+------------------------------ app layer (HTTP) ------------------------------------+
| identity stub -> route grant check -> provenance check -> ACT ROUTES               |
| turn route (SSE relay, keep-alive, disconnect => abort) -> AGENT LOOP              |
+------------------------------------------------------------------------------------+
        |                                   |                               |
   AGENT LOOP <-> PROVIDER ADAPTERS: Anthropic raw SSE | OpenAI-compatible (optional) | scripted
        |--> context manager: token budget, eviction, stable cache prefix
        |--> TOOL DOOR -> tool registry -> read ports ------------------------> STORE (SQLite)
        |                               -> propose_plan -> PLAN VALIDATOR (kernel + store)
        |                                                    -> TOKEN mint (HMAC) -> card
        |--> TRACE (JSONL spans, no content) + TURN RECORD (SQLite, no content)
   ACT ROUTES --[one transaction: the act + its STEP RECORD]--> STORE
```

| The model decides                           | The harness enforces (true whatever the model outputs)               |
| ------------------------------------------- | -------------------------------------------------------------------- |
| Which offered tool to call, with what input | Only offered tools run; an unoffered name ends the turn              |
| What plan to propose and in what words      | A proposal runs nothing; only a human Confirm reaches a route        |
| How to react to a refusal reason            | Every step is validated before a card exists                         |
| When to stop                                | Step limit, output-length, cancel and provider-error endings         |
| Nothing about permissions                   | Four permission checks; the route's grant check is the control       |
| Nothing about what the human sees           | The card is rendered from validated arguments, never from model text |
| Nothing about respondent answers            | No tool or port can read an answer value                             |

---

## 3. Stack and repo layout decisions

| Decision             | Choice                                                                | One-line justification                                                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language/runtime     | TypeScript (strict, ESM) on Node 24 LTS                               | Required; Node 24 is also what the reference toolchain uses, so a locally built kernel loads unchanged                                                                                             |
| Primary provider API | **Anthropic Messages API over raw `fetch`**, `stream: true`, no SDK   | You have access; its stream is explicit (typed content blocks, partial-JSON tool input, signed thinking blocks, cumulative usage, cache counters), so each harness concern is visible in the bytes |
| Second adapter       | OpenAI-compatible Chat Completions, **optional (Phase 12)**           | A different stream shape proves the adapter boundary; lets cheap local models run evals; first thing to cut                                                                                        |
| Local store          | **SQLite** via `better-sqlite3`, plain SQL migrations, no ORM         | Synchronous transactions make "act plus step record" one call; constraints stay readable; one file per test or trial                                                                               |
| HTTP                 | Hono + `@hono/node-server`                                            | Small; handlers are testable with `app.request()` without a socket                                                                                                                                 |
| Validation           | zod v4 (same major as the kernel's dependency)                        | One zod instance for kernel schemas and tool schemas; `z.toJSONSchema` for tool definitions                                                                                                        |
| Domain kernel        | `@roonga/qcms-core` as a pinned local tarball, else a zod mini-kernel | Not on npm, version 0.0.0, no built `dist`; see Phase 0 for the timebox and fallback                                                                                                               |
| Card UI              | Terminal CLI (`node:readline`)                                        | The card's content matters, not its pixels; no web UI                                                                                                                                              |
| Tests                | Vitest; three scripts: `test`, `test:contract`, `eval`                | Keeps the three evaluation groups physically separate                                                                                                                                              |
| Trace                | JSONL spans + `turns` table, written from week 2                      | You debug every later phase with it                                                                                                                                                                |
| Crypto               | WebCrypto HMAC-SHA-256 with an HKDF-derived key                       | No dependency; purpose-separated key                                                                                                                                                               |

```
qcms-harness-sandbox/
  docs/design/NN.md  docs/divergence-log.md  docs/provider-notes.md  docs/eval-reports/
  migrations/001_domain.sql 002_agent.sql ...
  vendor/roonga-qcms-core-0.0.0-<sha>.tgz        (absent if the mini-kernel is used)
  src/platform/   clock.ts ids.ts canonical-json.ts trace.ts
  src/kernel/     index.ts (facade over core or mini-kernel)  patch.ts
  src/store/      db.ts forms.ts questions.ts responses.ts grants.ts sessions.ts turns.ts steps.ts
  src/provider/   types.ts sse.ts anthropic.ts scripted.ts openai-compat.ts (optional)
  src/agent/      loop.ts endings.ts prompt.ts context.ts session.ts
  src/tools/      registry.ts door.ts reads.ts propose.ts schema.ts
  src/actions/    kinds.ts validate-plan.ts card.ts diff.ts
  src/provenance/ token.ts check.ts
  src/app/        server.ts identity.ts policy.ts route-policy.ts routes/*.ts
  src/cli/        chat.ts card.ts confirm.ts
  test/fixtures/sse/{anthropic,openai}/*.sse + *.meta.json
  test/deterministic/  test/contract/
  evals/          tasks/ graders/ approver.ts runner.ts stats.ts report.ts
```

---

## 4. Domain model (the sandbox's own default design)

**Tables.** Every table has constraints; tests prove the constraints refuse bad writes.

| Table                          | Key columns                                                                                                                                                                                          | Constraint that matters                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `workspaces`, `users`          | id, name                                                                                                                                                                                             | -                                                                                       |
| `grants`                       | user_id, workspace_id, role, environments (JSON list or `["all"]`)                                                                                                                                   | role in the closed set below                                                            |
| `questions`                    | question_id PK, workspace_id                                                                                                                                                                         | rows are never deleted, so an id can never be reused                                    |
| `question_versions`            | (question_id, version) PK, status `draft`/`published`, definition                                                                                                                                    | published rows immutable (trigger)                                                      |
| `forms`                        | form_id PK, workspace_id, slug UNIQUE                                                                                                                                                                | -                                                                                       |
| `form_drafts`                  | form_id PK, **revision** INTEGER >= 1, definition                                                                                                                                                    | every write is compare-and-swap on `revision`                                           |
| `form_versions`                | (form_id, version) PK, definition, published_at                                                                                                                                                      | immutable (trigger refuses UPDATE/DELETE)                                               |
| `form_env_state`               | (form_id, environment) PK, released_version, closed                                                                                                                                                  | environment in `dev`,`test`,`prod`                                                      |
| `responses`                    | session_id PK, form_id, form_version, environment, started_at, submitted_at                                                                                                                          | metadata only                                                                           |
| `answers`                      | (session_id, question_id), value                                                                                                                                                                     | **seeded with the sentinel `SENTINEL-ANSWER-9f2c71e4`**; no agent port reads this table |
| `sessions`, `session_messages` | (session_id, seq), role, content, evicted                                                                                                                                                            | conversation store; has content; separate from audit                                    |
| `turns` (**turn record**)      | turn_id, session_id, user_id, prompt_version, model, offered_tools, offered_kinds, model_calls, input/output/cache_read/cache_write tokens, stop_reason, ending, tool_errors, evictions, proposal_id | names, counts and codes only; **never user content**                                    |
| `step_records`                 | proposal_id, step_index, step_count, actor, workspace_id, environment, form_id, kind, outcome `done`/`failed`, error_code, detail, proposed_at, recorded_at                                          | UNIQUE(proposal_id, step_index); `detail` holds allowlisted non-content scalars         |

**Roles (four, deliberately not a ladder).** `viewer` (read questions and forms), `author` (viewer + write questions and drafts; publish and close only in non-`prod` environments within the grant's scope), `releaser` (read; publish and close in `prod`; cannot write a draft), `response-reader` (response counts and metadata only; cannot read forms). Environment scope applies to `form:publish`, `form:close` and `response:read`; everything else is workspace-wide.

**Action kinds.**

| Kind                                | Context     | Route                     | Permission     | Environment | Arguments (bound by the digest)                                 | Result fields        |
| ----------------------------------- | ----------- | ------------------------- | -------------- | ----------- | --------------------------------------------------------------- | -------------------- |
| `form.create`                       | authoring   | `POST /forms`             | form:write     | none        | workspaceId, slug, title                                        | formId               |
| `question.create`                   | authoring   | `POST /questions`         | question:write | none        | workspaceId, definition (incl. questionId)                      | questionId, version  |
| `form.saveDraft`                    | authoring   | `PUT /forms/:id/draft`    | form:write     | none        | formId, **expectedRevision** (number or null), whole definition | revision             |
| `form.patchDraft` (your divergence) | authoring   | `PATCH /forms/:id/draft`  | form:write     | none        | formId, baseRevision, ops[]                                     | revision             |
| `form.publish`                      | authoring   | `POST /forms/:id/publish` | form:publish   | argument    | formId, draftRevision, environment                              | version, environment |
| `form.close` (live state)           | operational | `POST /forms/:id/close`   | form:close     | argument    | formId, environment                                             | closed, environment  |

An argument may be a reference `{ fromStep, field }` to a result field of an earlier step. `form.publish` freezes the draft as a new immutable version, publishes any draft question versions it pins in the same transaction, and releases the version into one environment.

**Tools offered to the model.** Read: `search_questions`, `read_question`, `list_forms`, `read_form` (the complete draft plus its revision), `read_form_outline` (ids, counts, rule ids, revision), `validate_draft`, `count_responses`, `list_response_metadata`, and optionally `test_rule` (evaluate one rule against hypothetical answers). Propose: `propose_plan` (one to N steps; runs nothing).

---

## 5. Phases

| Weeks | Phase                                                                          | Hours |
| ----- | ------------------------------------------------------------------------------ | ----- |
| 1     | P0 Foundations: repo, SQLite, kernel, determinism                              | 8     |
| 2     | P1 Provider adapter, stream layer, trace                                       | 10    |
| 3     | P2 Agent loop, tool registry, read tools, scripted model                       | 10    |
| 4     | P3 Loop hardening: parallel calls, thinking, limits, endings, cancel, sessions | 9     |
| 5     | P4 Application layer: constraints, routes, identity, policy, SSE relay         | 10    |
| 6     | P5 Proposals: action kinds, plan validator, card                               | 10    |
| 7     | P6 Token, provenance, confirmed run, step records                              | 10    |
| 8     | P7 Permissions: the four checks                                                | 8     |
| 9     | P8 Draft safety: stale drafts, diff, patch tool                                | 9     |
| 10    | P9 Context: token budget, eviction, caching, crash-resume                      | 10    |
| 11    | P10 Evaluation harness, contract tests, suite completion                       | 9     |
| 12    | P11 Live evals, paired comparison, write-up                                    | 9     |
| 13    | P12 Buffer; optional second adapter                                            | 8     |

Total 112 hours over 12 required weeks, plus an 8-hour buffer week. If the buffer is unused, the project ends at week 12.

### P0 - Foundations (week 1, 8 h)

**Goal.** A repo where time, ids and JSON digests are deterministic, the domain data lives in SQLite with real constraints, and a draft can be validated.

**Design-first prompt.** "In one paragraph: what will the model be allowed to decide, and what must stay true no matter what it outputs? Name three things the harness must enforce even against a hostile model."

**Deliverables and types.**

```ts
interface Clock {
  now(): Date;
} // injected everywhere; tests use a manual clock
interface IdGen {
  next(prefix: string): string;
} // injected; tests use a counter
function canonicalJson(value: unknown): string; // sorted keys at every depth, undefined dropped
interface Kernel {
  parseQuestion(v: unknown): Result<Question>;
  parseForm(v: unknown): Result<Form>;
  validateDraft(
    form: Form,
    resolve: ResolveQuestionVersion,
  ): { issues: Issue[]; warnings: Issue[] };
  evaluate(form: Form, answers: AnswerMap): FlowState;
}
```

**Tasks.**

- T0.1 Repo, `tsc --noEmit`, Vitest, CI. _Accept:_ `pnpm test` green on an empty suite.
- T0.2 Kernel spike, **2-hour timebox**: build `@roonga/qcms-core` from the pinned commit, `pnpm pack` it, add the tarball under `vendor/`, record the commit SHA. _Accept:_ a sandbox test parses a fixture form through the facade. _If the timebox fails:_ write a zod mini-kernel (four question types, six operators, no repeating groups); budget about two days of effort, which consumes the week-13 buffer. Record the choice.
- T0.3 Migrations for the domain tables in section 4. _Accept:_ tests show a duplicate question id, an UPDATE of a published version and a stale-revision draft write are each refused by the database.
- T0.4 `Clock` and `IdGen` injected. _Accept:_ a lint test finds no `Date.now`, `new Date()` or `randomUUID` outside `src/platform/`.
- T0.5 `canonicalJson` and `digest` (SHA-256, base64url). _Accept:_ tests below.
- T0.6 Seed script: 2 workspaces, 4 users (one per role), a 12-question form with 4 rules, a 60-question form, responses whose answers include the sentinel.

**Deterministic tests.** `canonical.key-order-invariant` (same digest for reordered keys at depth 3); `canonical.undefined-dropped`; `canonical.non-finite-throws`; `db.question-id-never-reused` (insert refused); `db.published-version-immutable`; `seed.sentinel-present` (the sentinel is in `answers`, so later "absent" assertions mean something).

**Demo.** `pnpm seed`, then show SQLite refusing a duplicate question id and an edit to a published version; validate the seeded form through the facade.

**Compare after building.** `packages/core/src/index.ts` (what the kernel exports), `packages/core/package.json`, `apps/api/src/features/agent/proposal-token.ts:74-99` (canonical JSON and digest), `packages/db/src/schema/` (the reference store). _Divergence entries:_ store, kernel source.

**Pitfalls.** Two zod instances (tarball vs sandbox) break schema identity: deduplicate. A sentinel that was never inserted makes every later leak test pass vacuously.

### P1 - Provider adapter, stream layer, trace (week 2, 10 h)

**Goal.** Turn raw provider bytes into a small set of provider-neutral events, correctly under any chunking, with a trace from the first call.

**Design-first prompt.** "List the event types your loop will consume, with no provider named. What does the adapter do when a network chunk ends in the middle of an event, when a tool call's JSON is incomplete at the end of the stream, and when the caller aborts?"

**Deliverables and types.**

```ts
type ProviderEvent =
  | { type: "message_start"; model: string; usage: Usage }
  | { type: "text_delta"; block: number; text: string }
  | { type: "thinking_block"; block: number; raw: unknown } // whole block, signature included
  | { type: "tool_call_start"; block: number; id: string; name: string }
  | { type: "tool_call"; block: number; id: string; name: string; input: unknown }
  | {
      type: "tool_call_invalid";
      block: number;
      id: string;
      name: string;
      reason: "malformed_json" | "incomplete";
    }
  | { type: "message_end"; stopReason: StopReason; usage: Usage }
  | { type: "error"; retryable: boolean; status?: number; code: string }
  | { type: "aborted" };
interface Provider {
  stream(req: ModelRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}
```

**Tasks.**

- T1.1 Read the current Messages, streaming, tool-use and thinking docs; write `docs/provider-notes.md` (event list, stop reasons, the pinned `anthropic-version`, how thinking blocks must be returned, usage semantics). _Accept:_ the notes exist and name the doc date.
- T1.2 Byte-level SSE parser: LF and CRLF, multi-line `data:`, comment lines, UTF-8 split across chunks. _Accept:_ split tests below.
- T1.3 Anthropic adapter: request builder; event mapping; tool input accumulated from partial JSON and parsed once at block stop; malformed or unfinished JSON becomes `tool_call_invalid`, never a throw; `ping` ignored; an `error` event inside an HTTP 200 stream becomes `error`; unknown event types ignored and counted; idle timeout; abort cancels the fetch and ends with `aborted`.
- T1.4 `pnpm record`: capture raw bytes of five real calls (text, one tool, two parallel tools, thinking plus tool, output limit hit) with a `.meta.json` (date, model id, API version). _Accept:_ fixtures contain no API key.
- T1.5 Fixture replayer with chunkers: whole, one byte at a time, split at every offset, seeded random.
- T1.6 Trace v0: JSONL spans (`turn`, `model_call`, `tool_call`) with ids, durations, usage and byte counts; content capture off by default; `pnpm trace:show <turnId>`.

**Deterministic tests.** `sse.split-at-every-offset` (event sequence identical to the unsplit replay for every offset); `sse.one-byte-chunks`; `sse.crlf-and-comments`; `sse.utf8-split-mid-codepoint`; `anthropic.partial-json-accumulates` (one `tool_call` with the full object); `anthropic.malformed-tool-json` (`tool_call_invalid`, stream continues); `anthropic.keepalive-ignored` (pings produce no event and reset the idle timer); `anthropic.error-event-mid-stream`; `anthropic.unknown-event-ignored`; `anthropic.usage-not-double-counted` (usage in the closing event is cumulative); `anthropic.abort-mid-tool-input` (no `tool_call` emitted, ends `aborted`); `trace.no-content-by-default` (a canary string in the prompt is absent from the trace file).

**Demo.** `pnpm demo:stream "hello"` prints live events from the real API; replay the parallel-tools fixture at one-byte chunks and show identical output; `pnpm trace:show`.

**Compare after building.** `apps/api/src/features/agent/assistant.ts:271-320` (the stream as the reference sees it, already parsed by its SDK), `fake-model.ts` (its fake sits at the model interface, not at the byte level), `thinking.ts`, `handler.ts:416-473`. _Divergence entries:_ loop (stream half).

**Pitfalls.** Summing cumulative usage. Calling `JSON.parse` on partial input. Forgetting `TextDecoder` stream mode. Treating HTTP 200 as success. Logging thinking text.

### P2 - Agent loop, tool registry, read tools, scripted model (week 3, 10 h)

**Goal.** A working loop that reads questionnaire data through one guarded door and can be driven by a script instead of a network.

**Design-first prompt.** "Write the loop as pseudo-code in at most 15 lines. When does it stop? What happens when the model calls a tool you did not offer? What does the model receive when a tool's input is invalid?"

**Deliverables and types.**

```ts
interface ToolDef<I, O> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  permission?: Permission;
  maxResultBytes: number;
  execute(input: I, ctx: ToolContext): Promise<O>;
}
type Ending =
  | "proposed"
  | "no_proposal"
  | "step_limit"
  | "output_length"
  | "refused_tool"
  | "model_refusal"
  | "provider_error"
  | "cancelled"
  | "context_full";
interface TurnResult {
  ending: Ending;
  proposal?: Proposal;
  usage: Usage;
  modelCalls: number;
  toolErrors: number;
}
type Script = (conversation: Message[]) => AssistantBlock[]; // scripted model: one function per model call
```

**Tasks.**

- T2.1 Frozen registry and one door `runTool(name, input, ctx)`. _Accept:_ a name outside the offered list ends the turn as `refused_tool`; nothing executes; no further model call is made.
- T2.2 Sequential loop with a model-call limit (default 8). _Accept:_ `loop.step-limit`.
- T2.3 Input validated with zod; an invalid input is returned to the model as an error result with a short reason and counted in `toolErrors`; the turn continues.
- T2.4 Read tools from section 4 through ports that take the caller's identity; strict output schemas of enumerated fields. _Accept:_ `read_form` returns the stored draft deep-equal, with its revision.
- T2.5 Tool JSON Schema emitted from zod with deterministic key order.
- T2.6 Scripted provider and scripts `read-then-answer`, `unknown-tool`, `bad-input-then-fix`, `loop-forever`, `read-all` (calls every read tool once).
- T2.7 **Versioned system prompt:** `PROMPT_VERSION` plus a snapshot of prompt text and tool descriptions. _Accept:_ changing either without bumping the version fails a test.
- T2.8 Turn record v0 written at the end of every turn, whatever the ending.

**Deterministic tests.** `loop.read-then-answer`; `loop.unknown-tool-ends-refused`; `loop.invalid-input-returned-to-model` (two model calls, `toolErrors` = 1); `loop.step-limit` (ending `step_limit` after 8 calls); `tools.read-form-complete`; `sentinel.read-all` (sentinel present in the database; absent from every provider request body, every tool output, the trace, the turn record and stdout; and every read tool did run); `prompt.version-snapshot`; `turn-record.no-content` (a canary in the user message is absent from `turns`).

**Demo.** Chat with the real model: "which forms exist, and how many responses does the intake form have?"; show the trace; run the `unknown-tool` script and show the refused ending and its turn record.

**Compare after building.** `tools/registry.ts:24-71` (tool names), `:823-1088` (definitions), `:1129-1140` (the door), `assistant.ts:327-371` (stop conditions and the loop call), `assistant.ts:425-437` (what a turn logs), `system-prompt.ts:3-4,39-40`, `assist.integration.test.ts` (sentinel), agent `README.md` section "The registry and the door are security controls". _Divergence entries:_ loop, audit/turn record.

**Pitfalls.** A scripted model that bypasses the door tests nothing. Tool descriptions are prompt text: version them. A leak test that does not assert each tool ran is vacuous.

### P3 - Loop hardening (week 4, 9 h)

**Goal.** The loop behaves correctly under parallel tool calls, reasoning blocks, oversized results, every kind of ending, cancellation and provider failure, and sessions survive between turns.

**Design-first prompt.** "List every way a turn can end and how a user tells them apart. A cancel arrives while two tool calls are running: say exactly what is persisted and why the next turn's request is still valid."

**Deliverables.** `assertWellFormed(messages)`; session store; endings classifier; retry policy.

**Tasks.**

- T3.1 **Parallel tool calls:** all calls in one assistant message run concurrently; all results go back in one user message, in call order; one failure does not cancel the others.
- T3.2 **Thinking blocks:** store each thinking or redacted block whole (signature included) and resend it unchanged with the tool results; never trace or log its text; a `THINKING` setting of `off`, `summarized` or `omitted`; reasoning that arrives unasked is dropped from display but still round-tripped if the provider requires it.
- T3.3 **Tool output size limit:** per-tool `maxResultBytes`; an oversized result becomes `{ tooLarge: true, bytes, hint }`, never a cut body; list tools page with `truncated` and `nextCursor`.
- T3.4 Endings: output limit reached inside a tool call discards that call (ending `output_length`); provider refusal maps to `model_refusal`.
- T3.5 **Cancel:** the abort signal reaches the provider and every tool; the in-flight assistant message and its partial results are not persisted; ending `cancelled`; the turn record is still written.
- T3.6 **Provider error after a tool call:** completed call/result pairs are persisted; the failed model call adds nothing; ending `provider_error` with a retryable flag; a "continue" resumes without re-running tools. Retry twice with backoff and jitter on 429/5xx/overloaded, only before any output reached the client.
- T3.7 Session store: messages persisted per completed pair in one transaction; the client sends only the new user message.
- T3.8 Turn record completed: ending, `tool_errors`, `model_calls`.

**Deterministic tests.** `loop.parallel-two-reads` (byte fixture: two calls, one user message, two results in call order); `loop.parallel-one-fails`; `thinking.round-trip-bytes` (block and signature byte-identical in the next request); `thinking.never-traced`; `limits.oversized-result-not-truncated`; `ending.output-length-mid-tool` (no tool ran); `ending.three-lookalikes` (three scripts end `step_limit`, `no_proposal`, `output_length` respectively); `cancel.mid-stream-no-orphan` (session passes `assertWellFormed`; the next turn's request is accepted by the scripted provider's validator); `cancel.mid-tool`; `provider-error.after-tool-call` (tool executed once across failure and continue); `retry.429-then-ok` (manual clock shows the backoff waits).

**Demo.** Ask something that needs two reads and show overlapping tool spans; press Ctrl-C mid-stream; send another message and get an answer.

**Compare after building.** `assistant.ts:381-410` (how step limit, output length and no proposal are told apart), `:157-182` and `:461-475` (provider failures), `:208-216` (tool failure counting), `:277-281` (reasoning parts), `schema.ts:6-9,108-112` (conversation limits and who holds the conversation), agent `README.md` scripts `tool-then-provider-error`, `length`, `step-limit`, `reasoning`. _Divergence entries:_ sessions, turn endings.

**Pitfalls.** Splitting parallel results across messages. Executing a tool call that the output limit cut short. Retrying after output was shown. Persisting a tool call without its result.

### P4 - Application layer (week 5, 10 h)

**Goal.** Every act the assistant will later propose already exists as an ordinary HTTP route a human can call, guarded by identity, a grant check and database constraints.

**Design-first prompt.** "Forget the model. A person with curl must be able to do every act. List the routes, who may call each, and which database constraint backs each rule you care about. What does your identity stub prove, and what does it not?"

**Deliverables and types.**

```ts
type Permission =
  | "question:read"
  | "question:write"
  | "form:read"
  | "form:write"
  | "form:publish"
  | "form:close"
  | "response:read";
function decide(
  grants: Grant[],
  ask: { permission: Permission; workspaceId: string; environment?: string },
): boolean;
interface RoutePolicy {
  method: string;
  path: string;
  permission: Permission;
  environmentFrom: "none" | "body";
}
```

**Tasks.**

- T4.1 Identity stub: `x-user` header resolves a `users` row, else 401. Documented as a stub.
- T4.2 `decide` and the four roles. _Accept:_ `policy.not-a-ladder`.
- T4.3 The six act routes; one `route-policy.ts` table; middleware refuses any route without a row.
- T4.4 Draft writes are compare-and-swap on `expectedRevision` (409 `DRAFT_STALE`); publish checks `draftRevision`, compiles through the kernel, publishes pinned draft question versions, writes the version and the environment state in one transaction; close flips live state in one environment.
- T4.5 Read routes, including response counts and metadata. No route returns an answer value.
- T4.6 **Turn route** `POST /sessions/:id/turns`: relays turn events as SSE; **keep-alive** comment after 15 s of silence (timer injected); **client disconnect aborts** the upstream model call.
- T4.7 CLI for humans: `qh act <kind> ...` calls the routes directly.

**Deterministic tests.** `routes.unlisted-route-refused`; `policy.not-a-ladder` (releaser cannot save a draft; author cannot close in `prod`; response-reader cannot read a form); `policy.env-scope` (author scoped to dev and test gets 403 publishing to `prod`); `draft.cas-stale-409`; `publish.revision-moved-409`; `publish.immutable-version`; `question.id-never-reused-409`; `sse.keepalive-after-silence`; `sse.client-disconnect-aborts-upstream` (the scripted provider observes the abort; ending `cancelled`); `responses.no-answer-route`.

**Demo.** As the author: create a form and a question, save a draft, publish to `test`. As the viewer: 403. A second save with an old revision: 409. No model involved.

**Compare after building.** `apps/api/src/registrars.ts:31-58` (middleware order), `apps/api/src/features/membership/policy.ts` (roles `:50-93`, environment scope `:141-151`, form scope `:154-159`, decision `:249-272`), `features/membership/route-policy.ts`, `features/forms/handler.ts:234-246` and `:1586`, `features/agent/handler.ts:416-492` (SSE relay). _Divergence entries:_ roles, stale draft, question publishing.

**Pitfalls.** Permission checks that live only on the agent path. Read-then-write without a transaction for the revision check. A keep-alive timer that outlives the stream.

### P5 - Proposals: action kinds, plan validator, card (week 6, 10 h)

**Goal.** The model can ask for changes only by proposing a plan, which is validated in full and shown to a human as a card with its true arguments, and which runs nothing.

**Design-first prompt.** "Decide and justify: what does the model get back from a propose call? What makes a plan invalid? Can a later step use an id that an earlier step creates, and how is that written? How many proposals may one turn make, and how long may a plan be? What exactly does the human see, and where does each displayed value come from?"

**Deliverables and types.**

```ts
interface ActionKindDef {
  kind: string;
  context: "authoring" | "operational";
  route: { method: string; path: string };
  permission: Permission;
  environmentFrom: "none" | "argument";
  args: z.ZodType;
  resultFields: readonly string[];
}
type StepRef = { fromStep: number; field: string };
interface PlanStep {
  kind: string;
  args: Record<string, unknown>;
  environment: string | null;
  issues: Issue[];
  warnings: Issue[];
}
type ProposeOutcome = { ok: true; proposal: Proposal } | { ok: false; reason: string };
```

**Tasks.**

- T5.1 Registry of the six kinds from section 4.
- T5.2 `propose_plan`: returns `{ proposed: true, proposalId }` or `{ proposed: false, reason }`. The model never receives the card or anything it could use to confirm. A refusal goes back to the model and the turn continues.
- T5.3 Validator, in this order: caps (your per-turn proposal limit and plan-length limit; defaults one and 25) -> per step: known kind, argument schema, references (earlier step only, field in that kind's result fields) -> domain: question definitions parse; a question id is unused in the store and within the plan; each draft validates against the store plus the questions that **earlier** steps of the plan create, so a pin of such a question counts as an allowed unpublished pin -> plan shape: authoring and operational steps are not mixed; publish follows every draft write.
- T5.4 Card renderer: per step the kind, environment and full arguments, plus the harness's own validation issues and warnings, plus expiry. Built from validated arguments only.
- T5.5 `proposal` turn event emitted as soon as a plan is accepted; endings `proposed` and `no_proposal` wired.
- T5.6 Scripts: `plan-create-form`, `two-proposals`, `plan-26-steps`, `bad-fromstep`, `reused-question-id`, `mixed-plan`, `invalid-operator-then-fix`, `injection-follow`.

**Deterministic tests.** `propose.runs-nothing` (database unchanged after an accepted plan); `propose.second-in-turn-refused` (reason returned, turn continues, exactly one card); `propose.26-steps-refused`; `propose.fromstep-forward-refused`; `propose.fromstep-unknown-field-refused`; `propose.reused-question-id-refused` (existing id, and duplicate inside the plan); `propose.unpublished-pin-of-own-question-allowed`; `propose.pin-of-unknown-question-refused`; `propose.create-after-save-refused`; `propose.mixed-authoring-operational-refused`; `propose.invalid-operator-recovery` (scripted: first plan refused with a reason naming the operator, second accepted, one card); `card.shows-true-arguments` (the `injection-follow` script obeys an instruction hidden in a question title and adds a `form.close` in `prod` while its prose says "small title fix"; the card lists `form.close`, `prod`; nothing has run).

**Demo.** Real model: "create a contact form; show the 'please specify' question only when 'other' is chosen". Show the card, the unchanged database and the turn record. Then run `two-proposals`.

**Compare after building.** `tools/propose.ts` (`:31` and `:752-761` caps, `:188-207` references, `:261-277` used ids, `:661-730` drafts and pins, `:814-823` mixed plans, `:854-916` the whole build), `tools/registry.ts:650-678,1067-1087`, `actions/types.ts`, `actions/forms.ts`, `actions/questions.ts`, `actions/releases.ts`, `proposal-token.ts:13`, agent `README.md` sections "A card never offers a step the route would reject" and "form.saveDraft takes a form from nothing to a reviewable draft". _Divergence entries:_ one-proposal-per-turn, question publishing, framing.

**Pitfalls.** Validating each step against today's store instead of the state earlier steps will leave. Vague refusal reasons (they are prompts). Rendering the card from model prose. Trusting the model's own `validate_draft` call.

### P6 - Token, provenance, confirmed run (week 7, 10 h)

**Goal.** One human Confirm runs the plan step by step through the ordinary routes, and the server can prove each request is the step the human saw.

**Design-first prompt.** "A person pressed Confirm. What stops (a) a different user, (b) changed arguments, (c) a second use, (d) a different route, (e) running step 3 after step 2 failed, (f) a card left open overnight? For each, say whether the check needs stored state. State in one sentence what rights the token grants."

**Deliverables and types.**

```ts
interface TokenPayload {
  v: 1;
  purpose: "proposal";
  sub: string;
  pid: string;
  iat: number;
  exp: number;
  steps: { kind: string; argsDigest: string; environment: string | null }[];
}
type ProvenanceCode =
  | "MALFORMED"
  | "SIGNATURE"
  | "SUBJECT"
  | "STEP_RANGE"
  | "EXPIRED"
  | "WINDOW"
  | "ORDER"
  | "ROUTE"
  | "ENVIRONMENT"
  | "ARGUMENTS"
  | "REFERENCE";
type StepOutcome = "done" | "failed" | "not-run"; // not-run is derived: no record exists
```

**Tasks.**

- T6.1 Token: HMAC-SHA-256 over the canonical JSON payload; key derived for this purpose from `APP_KEY`; **arguments are canonicalised before the digest is computed**, with references left symbolic.
- T6.2 Confirm runner (CLI): one Confirm; sends each step in order to its ordinary route with the token and a step-index header; sends symbolic references; stops at the first failure.
- T6.3 Provenance middleware, mounted **after** identity and the grant check: signature -> subject equals caller -> index in range -> step 0 not past expiry (default 10 min); later steps inside a run window measured from step 0's record -> steps 0..i-1 recorded `done` and step i not recorded -> route resolves to the bound kind -> environment matches -> digest of the request's canonical arguments matches -> references resolved from step records. A token that fails is refused; it never falls back to an ordinary request.
- T6.4 **Act plus record in one transaction:** the handler performs the act and inserts the `done` row together; UNIQUE(proposal_id, step_index) is only the backstop for races. If the act fails after provenance passed: roll back, then record `failed` with an error code. A provenance refusal records nothing.
- T6.5 `GET /proposals/:pid/steps` returns `done`/`failed`/`not-run` per index; the card shows it.
- T6.6 Result message for the next turn: one line per step built from structured fields (kind, outcome, allowlisted scalars); no model text.
- T6.7 **Scripted approver** for tests: `confirmAll`, `rejectAll`, `asOtherUser`, `tamper(step, fn)`, `delay(ms)`, `sendStepDirectly(i)`, `revokeThenConfirm`.

**Deterministic tests.** `confirm.happy-three-steps`; `confirm.tampered-args` (403 ARGUMENTS, no act, no row); `confirm.other-user` (SUBJECT); `confirm.expired` (clock at 10 min 1 s before step 0: EXPIRED); `confirm.run-crosses-expiry-ok`; `confirm.window-exceeded` (WINDOW); `confirm.replay-step` (ORDER from the recorded-step check; act not repeated); `confirm.race-two-step0` (exactly one succeeds); `confirm.step2-fails-step3-direct` (**the test sends step 3 by raw HTTP right after step 2 fails, bypassing the runner**: ORDER, no act, report is done/failed/not-run); `confirm.failed-step-rolls-back-act`; `confirm.wrong-route` (a save-draft step's token sent to the publish route: ROUTE); `confirm.wrong-environment`; `confirm.token-adds-no-rights` (a caller without the grant gets 403 from the grant check even with a valid token); `confirm.forged-signature`; `confirm.token-without-step-header`.

**Demo.** Real plan, press Confirm, watch done/done/done; run again with `--tamper` and show the refusal code; show `step_records` in SQLite.

**Compare after building.** `proposal-token.ts` (`:11` lifetime, `:16-38` payload, `:74-99` canonical JSON, `:101-123` key derivation, `:160-174` codes), `provenance.ts` (`:74-112` references, `:146-150` run window, `:163-179` order, `:181-239` the check), `provenance-mount.ts:93-163`, `apps/api/src/registrars.ts:36-43`, `audit.ts`, `packages/db/src/schema/control/agent-actions.ts`, `apps/admin/lib/server/agent-proposal.ts`, `apps/admin/lib/agent/plan-state.ts:125-198`, `provenance.integration.test.ts:826-869`, agent `README.md` section "A step's row is written where the step's act is not". _Divergence entries:_ audit/turn record, failed-step record, reference resolution.

**Pitfalls.** Digesting raw request bytes instead of canonical parsed arguments. A step-3 test that goes through your own runner (it proves only the client). Recording `failed` on a provenance refusal. Believing the token authorises anything.

### P7 - Permissions: the four checks (week 8, 8 h)

**Goal.** A missing permission is reflected at four points, and the tests show which one is the control.

**Design-first prompt.** "A user lacks a permission. List every point between 'the model is told what it can do' and 'the database changes' where that fact is checked. Say what the model sees and what the human sees at each point. Which one is the real control, and what are the others for?"

**Tasks.**

- T7.1 Check 1, offered tools: a read tool is offered only if the caller holds its permission somewhere; `propose_plan` only if at least one kind is offered.
- T7.2 Check 2, offered kinds: the propose schema contains only held kinds; for `form.publish` and `form.close` the `environment` enum is narrowed to the environments the caller holds that permission in.
- T7.3 Check 3, per subject at propose time: the form or workspace each step names (or the workspace of the step that creates it) is authorised before it is read; the reason names the missing permission, never who holds it.
- T7.4 Check 4, the route grant check from P4, evaluated at confirm time against current grants.
- T7.5 The door re-checks each read on the subject it resolved; a form in a workspace the caller cannot read looks the same as a missing form.
- T7.6 The system prompt states what this user may change; a read-only user gets no propose tool.
- T7.7 Turn record gains `offered_kinds`; record a hash of the offered tool set (used in P9).

**Deterministic tests.** `perm.viewer-has-no-propose-tool` (absent from the request body); `perm.kind-absent-from-schema`; `perm.env-enum-narrowed` (author scoped to dev and test: enum is exactly those two; a scripted proposal naming `prod` is refused with the available list; the turn continues); `perm.unoffered-kind-vs-unoffered-tool` (naming an unoffered kind is a refusal the model can recover from; calling an unoffered tool ends the turn `refused_tool`); `perm.subject-check-before-read` (a spy shows the other workspace's draft was never read); `perm.revoked-before-confirm` (grant removed after the card: step 0 gets 403 from the route, nothing recorded); `perm.read-cross-workspace-not-found`; `perm.close-prod-needs-releaser`.

**Demo.** The same request as viewer, as author (dev and test) and as releaser: three tool lists in the trace, three outcomes.

**Compare after building.** `handler.ts:214-229` and `:254-310`, `grant-filter.ts:54-99`, `tools/propose-schema.ts:19-66`, `tools/propose.ts:284-309,475-511`, `apps/api/src/registrars.ts:38-43`, `features/membership/policy.ts` in full, agent `README.md` section "The screen is context, not a permission list". _Divergence entries:_ roles.

**Pitfalls.** Calling checks 1 to 3 "security": they are honesty and defence in depth; check 4 is the control. Refusal reasons that reveal other people's grants.

### P8 - Draft safety: stale drafts, diff, patch tool (week 9, 9 h)

**Goal.** A human never confirms a draft change that silently overwrites someone else's edit, and the assistant can change part of a large form without re-emitting it.

**Design-first prompt.** "Two people edit one form; one works through the assistant. Between the assistant reading the draft and the human pressing Confirm, the other person saves. What happens, and what had the human been shown? Separately: how does the assistant change one rule in a 60-question form without sending the whole form back, and who applies the change to what?"

**Deliverables and types.**

```ts
type PatchOp =
  | { op: "addStep"; stepId: string; title: Text; afterStepId?: string }
  | { op: "removeStep"; stepId: string }
  | {
      op: "addQuestionRef";
      stepId: string;
      questionId: string;
      version: number;
      afterQuestionId?: string;
    }
  | { op: "removeQuestionRef"; questionId: string }
  | { op: "moveQuestionRef"; questionId: string; stepId: string; afterQuestionId?: string }
  | { op: "upsertRule"; rule: Rule }
  | { op: "removeRule"; ruleId: string }
  | { op: "setTitle"; title: Text };
function applyPatch(draft: Form, ops: PatchOp[]): Result<Form, { opIndex: number; code: string }>; // pure, atomic
```

**Tasks.**

- T8.1 A `form.saveDraft` step must carry `expectedRevision` equal to the current revision at propose time, else it is refused with "read the form again".
- T8.2 Card diff computed by the harness between the draft at that revision and the proposed draft: steps, question references and rules added, removed or changed, with rule conditions in full.
- T8.3 At confirm, the route's compare-and-swap fails the step with `DRAFT_STALE` if the revision moved; the card says the draft changed; later steps are not-run.
- T8.4 `form.patchDraft`: id-addressed ops; at propose time the **harness applies the ops to a fresh read** at `baseRevision`, validates the result and renders the diff; at confirm the route re-reads, checks the revision, re-applies, validates, writes and records in one transaction. The digest binds formId, baseRevision and the ops.
- T8.5 Read-freshness guard: a wholesale `form.saveDraft` is refused unless this session holds a complete, non-evicted `read_form` result for that form at the current revision. The harness tracks this; it does not trust the model.
- T8.6 Scripted 60-question migration across four plans (15 `question.create` plus one `form.patchDraft` each), each within the plan-length limit.

**Deterministic tests.** `stale.propose-with-old-revision-refused`; `stale.confirm-after-other-save-fails-step` (outcome failed/`DRAFT_STALE`; the stored draft is the other person's); `diff.card-matches-applied` (applying the confirmed step yields exactly the draft whose diff was shown); `patch.atomic-on-bad-op` (op 3 of 5 invalid: nothing applied, error names op 3); `patch.id-addressed-survives-reorder`; `patch.result-validated` (removing a question a rule still references is refused with the kernel's issue); `patch.confirm-reapplies-on-fresh-read`; `guard.save-without-fresh-read-refused`; `migration.60-questions-4-plans` (60 references, draft validates, pre-existing rules deep-equal).

**Demo.** On the 60-question form ask "show Q41 only when Q7 is yes": the card shows a one-rule diff. Save the draft as another user in a second terminal; Confirm fails as stale; ask again and confirm.

**Compare after building.** `handler.ts:505-516`, `tools/propose.ts:773-807`, `proposal-token.ts:29-35`, `provenance.ts:152-161`, `features/forms/handler.ts:1586`, `tools/registry.ts:853-865`, agent `README.md` sections "A plan built from the saved draft is bound to that draft" and lines 149-153. _Divergence entries:_ stale draft, patch tool.

**Pitfalls.** Index-based patches (they break on reorder). A diff built from the model's summary. Validating per op instead of the final draft. A guard keyed on "has read" rather than on the revision.

### P9 - Context: token budget, eviction, caching, crash-resume (week 10, 10 h)

**Goal.** Long sessions stay within a token budget without ever shortening data the model must send back, the request prefix stays byte-stable for caching, and an interrupted turn or run can be resumed.

**Design-first prompt.** "The conversation no longer fits. What may be dropped, what may never be dropped or shortened, and how does the assistant get back something it needs again? Which bytes of your request are identical on every call, and what would change them?"

**Tasks.**

- T9.1 **One conversation-level limit: a token budget** (a configured share of the model's context), measured from the provider's reported usage plus a count or estimate of new content. There is **no turn-count cap and no character cap** on the conversation. (Per-result size limits from P3 and the plan-length limit from P5 bound a single payload; they are not conversation limits.)
- T9.2 Eviction: above a high-water mark, replace the **oldest tool results** with a stub `{ evicted: true, tool, args, hint }` until below a low-water mark. A result is whole or a stub, never shortened. Nothing from the current turn is evicted. An evicted `read_form` trips the P8 guard, forcing a re-read before any wholesale save. User and assistant text is never evicted; if the budget still cannot be met the turn ends `context_full`.
- T9.3 **Stable prefix:** the request is tools (sorted, deterministic JSON) then system prompt (versioned; no timestamps, ids or user names) then messages. One cache breakpoint at the end of the system prompt, one on the last conversation block. Dynamic context (current form, date) goes in the conversation, never in the system prompt. Keep thinking settings and tool choice constant within a session. Check the prefix exceeds the model's minimum cacheable length.
- T9.4 Eviction and caching together: an eviction changes history from the first evicted block, so the conversation part of the cache is lost from there while the tools-plus-system prefix still hits. Evict in batches (the gap between the two marks) so this happens rarely. Record `evictions`, cache-read and cache-write tokens per call. **Report two numbers:** prefix hit rate (calls whose cache-read covers the tools-plus-system prefix) and conversation reuse ratio (cache-read over total input), each split into calls with and without an eviction since the previous call. Tool sets differ per permission profile: key the expectation by the offered-set hash from P7.
- T9.5 **Crash-resume (this phase only).** Turn level: a process killed mid-turn leaves a session that passes `assertWellFormed`; a start-up sweep marks the turn record `interrupted`; the user resends. Run level: `qh resume <proposalId>` reads the step report and continues at the first not-run index if still inside the run window; it never resends a recorded step.

**Deterministic tests.** `budget.no-eviction-under-high-water`; `evict.oldest-first-whole-or-stub` (no stored result is a prefix of its original); `evict.current-turn-untouched`; `evict.read-form-forces-reread` (scripted save refused with the re-read reason, accepted after a re-read); `evict.pairs-stay-wellformed`; `cache.prefix-byte-stable` (20 turns: hash of tools plus system identical in every request); `cache.prefix-changes-with-grants`; `cache.no-dynamic-data-in-system` (changing clock and user leaves the system bytes unchanged); `cache.eviction-changes-only-from-first-evicted-block`; `resume.turn-killed-mid-stream`; `resume.run-continues-at-first-unrecorded`; `resume.after-window-refused`.

**Demo.** A long session on the 60-question form: per-call table of input, cache-read, cache-write and evictions; then the forced re-read; then kill the CLI between steps and `qh resume`.

**Compare after building.** `schema.ts:6-9,108-112`, `assistant.ts:66-76` and `system-prompt.ts:39-40` (what the reference keeps stable for caching), `tools/registry.ts:853-865`, agent `README.md:149-153`. Search the agent slice for truncation, summarisation or eviction and note what you find. _Divergence entries:_ context limits, sessions.

**Pitfalls.** Summarising or cutting a draft. Evicting one result per turn (the cache never settles). Cache lifetime is short and counted from request start: slow eval pacing shows as misses. A prefix below the minimum cacheable length gives a hit rate of zero by design: report it rather than tune it.

### P10 - Evaluation harness, contract tests, suite completion (week 11, 9 h)

**Goal.** A runner that can execute any task many times in isolation and grade it with named graders, a contract-test group against the real provider, and a deterministic suite with no gaps against section 6.

**Design-first prompt.** "What question does each of your three test groups answer? For each, what result would make you change code, change the prompt, or change nothing? How will you know that a prompt change helped rather than got lucky?"

**Tasks.**

- T10.1 Audit the deterministic suite against section 6.1; add what is missing.
- T10.2 Runner: a task is seed data, user turns, an approver policy and graders. Each trial gets a fresh SQLite file from a seed snapshot and an injected clock. Per trial it stores grader results, turn records, tokens, cost and ending. Resumable; concurrency limit; **budget guard** that stops the run at a spend cap.
- T10.3 Graders (section 6.3) with their own unit tests on known-good and known-bad drafts.
- T10.4 Approver policies for evals: `confirm-all`, `confirm-if-kinds-within(expected)`, `reject-unrequested-kinds`.
- T10.5 Contract tests (`pnpm test:contract`, section 6.2). If the provider rejects a tool schema (the recursive condition schema is the likely one), write a rewrite to a bounded, self-contained schema and keep zod as the validator of what the model sends.
- T10.6 Report generator: pass rate with interval, tokens mean and SD, cost, endings histogram, model id, prompt version, date.

**Deterministic tests.** `runner.trial-isolation` (a write in trial 1 is invisible in trial 2); `runner.budget-guard-stops`; `grader.flow-oracle-known-good` and `-known-bad`; `grader.no-collateral-detects-dropped-rule`; `stats.wilson-interval`; `stats.mcnemar-exact`.

**Demo.** `pnpm eval --task L1 --n 3` on a small model; open the generated report; `pnpm test:contract`.

**Compare after building.** `fake-model.ts` and the script list in the agent `README.md` ("The deterministic fake provider"), `assist.integration.test.ts`, `tools/tool-schema.ts` and its test, `tools/registry.test.ts`. Note which of your three groups the reference has. _Divergence entries:_ evaluation.

**Pitfalls.** Graders that read model prose when a database check exists. Trials sharing a database. A contract failure filed as a harness bug.

### P11 - Live evals, paired comparison, write-up (week 12, 9 h)

**Goal.** One honest measurement of the assistant and one honest before/after comparison, written up with their uncertainty.

**Design-first prompt.** "Pick one change you believe helps (a prompt edit, or eviction on vs off). Before running anything, write down the tasks, the trial count, the metric, and the result that would make you revert the change."

**Tasks.**

- T11.1 Pilot: 5 trials per task on a small model; fix task and grader bugs; measure tokens per trial and update the budget.
- T11.2 Baseline campaign at the trial counts in section 6.3.
- T11.3 One paired comparison: same task instances, arm A before and arm B after the change.
- T11.4 Noise floor: run the baseline twice (A against A) and report the difference.
- T11.5 Write-up: README with the architecture, the final divergence log, the eval report and the honest-claim paragraph from section 1.
- T11.6 Rehearse section 10 aloud, each answer anchored to a test or demo.

**Deterministic tests.** None new. _Accept:_ the report shows intervals, the A/A result and the paired result, and states which differences are not detectable.

**Demo.** The report, then a two-minute walk through one failed trial using its trace and turn record.

**Compare after building.** Re-read the agent `README.md` top to bottom and list everything the reference does that you never built (screens and facts, audited reads, hand-off steps, two-person rule). That list goes in your README under "not built".

**Pitfalls.** Changing the prompt after seeing eval failures and re-reporting on the same tasks without saying so (keep two held-out briefs). Reporting a mean without its interval.

### P12 - Buffer; optional second adapter (week 13, 8 h)

**Goal.** Absorb overrun; if none, prove the adapter boundary with an OpenAI-compatible provider.

**Design-first prompt.** "Which fields of your `ProviderEvent` and `ModelRequest` turned out to be shaped by one provider? Predict what will break before you write the adapter."

**Tasks.** T12.1 Adapter for Chat Completions streaming: tool-call argument fragments keyed by index, the `[DONE]` terminator, finish-reason mapping, no signed thinking blocks. T12.2 Record byte fixtures from a local OpenAI-compatible server. T12.3 Run the whole deterministic stream suite against the new fixtures. T12.4 Contract test: is every tool schema accepted?

**Deterministic tests.** `openai.split-at-every-offset`; `openai.tool-args-by-index` (two interleaved calls reassembled); `openai.done-terminator`; `openai.malformed-args`. **Demo.** The same chat demo with `PROVIDER=openai-compat`. **Compare after building.** `assistant.ts:505-531`, `tools/tool-schema.ts:1-14`, `docs/agent-authoring.md` (local-model section). **Pitfalls.** Leaking provider names above the adapter; assuming a local model does tool calling.

---

## 6. Evaluation methodology

Three groups, kept in three commands. Never merge their results into one number.

| Group                           | Command              | Model                       | Answers                                                                                                   | Runs                                   |
| ------------------------------- | -------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 6.1 Deterministic harness tests | `pnpm test`          | scripted, or byte fixtures  | "Does the harness enforce its rules whatever the model does?" Pass/fail.                                  | Every commit                           |
| 6.2 Contract tests              | `pnpm test:contract` | real provider, tiny prompts | "Does the provider still behave as my adapter assumes?" Pass/fail; a failure is drift, not a harness bug. | Weekly and on adapter or schema change |
| 6.3 Live evals                  | `pnpm eval`          | real model                  | "How often does the assistant do the task?" A rate with uncertainty.                                      | Per campaign                           |

### 6.1 Deterministic scenarios (expected result; phase)

| Scenario                                               | Test                                                                                                                                                                | Expected                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Arguments tampered between card and confirm            | `confirm.tampered-args`                                                                                                                                             | 403 ARGUMENTS; no act; no record (P6)                                                              |
| Confirm by another user                                | `confirm.other-user`                                                                                                                                                | 403 SUBJECT (P6)                                                                                   |
| Expired proposal                                       | `confirm.expired`                                                                                                                                                   | 403 EXPIRED; a run that started in time may finish (P6)                                            |
| Step 2 fails, step 3 sent directly                     | `confirm.step2-fails-step3-direct`                                                                                                                                  | 403 ORDER from the server; report done/failed/not-run (P6)                                         |
| Replay of a confirmed step                             | `confirm.replay-step`, `confirm.race-two-step0`                                                                                                                     | refused by the recorded-step check; the unique constraint settles the race (P6)                    |
| Token presented to a different route                   | `confirm.wrong-route`                                                                                                                                               | 403 ROUTE (P6)                                                                                     |
| Bad `fromStep` reference                               | `propose.fromstep-forward-refused`, `-unknown-field-refused`                                                                                                        | refused with reason; turn continues (P5)                                                           |
| Reused question id                                     | `propose.reused-question-id-refused`                                                                                                                                | refused with reason (P5)                                                                           |
| Two proposals in one turn                              | `propose.second-in-turn-refused`                                                                                                                                    | second refused; one card (P5)                                                                      |
| Mixed authoring and operational plan                   | `propose.mixed-authoring-operational-refused`                                                                                                                       | refused: "two plans" (P5)                                                                          |
| Recovery from an invalid operator (scripted, not live) | `propose.invalid-operator-recovery`                                                                                                                                 | refusal reason reaches the script; corrected plan accepted (P5)                                    |
| Permission revoked before confirm                      | `perm.revoked-before-confirm`                                                                                                                                       | 403 from the route grant check (P7)                                                                |
| Kind or environment not held                           | `perm.env-enum-narrowed`, `perm.unoffered-kind-vs-unoffered-tool`                                                                                                   | absent from schema; recoverable refusal vs `refused_tool` ending (P7)                              |
| Cancel mid-stream, no orphaned tool call               | `cancel.mid-stream-no-orphan`, `sse.client-disconnect-aborts-upstream`                                                                                              | session well-formed; upstream aborted (P3, P4)                                                     |
| Provider error after a tool call                       | `provider-error.after-tool-call`                                                                                                                                    | tool ran once; ending `provider_error` (P3)                                                        |
| Parallel tool calls                                    | `loop.parallel-two-reads`                                                                                                                                           | one user message, results in call order (P3)                                                       |
| Step-limit vs no-proposal vs output-length             | `ending.three-lookalikes`                                                                                                                                           | three distinct endings (P3, P5)                                                                    |
| Injection in a question title                          | `card.shows-true-arguments`                                                                                                                                         | scripted model obeys it; card shows the true kind and arguments; nothing runs without Confirm (P5) |
| Sentinel answer                                        | `sentinel.read-all` (re-run in every later phase)                                                                                                                   | present in the database; absent from every tool output, prompt, trace and log (P2)                 |
| Stale draft                                            | `stale.confirm-after-other-save-fails-step`                                                                                                                         | step failed `DRAFT_STALE` (P8)                                                                     |
| Wholesale save after eviction                          | `evict.read-form-forces-reread`                                                                                                                                     | refused until re-read (P9)                                                                         |
| Stream layer                                           | `sse.split-at-every-offset`, `anthropic.partial-json-accumulates`, `anthropic.malformed-tool-json`, `anthropic.keepalive-ignored`, `anthropic.abort-mid-tool-input` | identical events under any chunking (P1)                                                           |

All of these use the injected clock and id generator, and digests are computed over canonical JSON.

### 6.2 Contract tests (real provider)

`contract.tool-schemas-accepted` (every tool schema, including the recursive condition schema, is accepted and a forced call parses; this is where "a schema one provider rejects" belongs); `contract.fixtures-still-match` (re-record and compare event-type sequences); `contract.thinking-round-trip-accepted`; `contract.parallel-results-accepted`; `contract.cache-counters` (second identical call reports cache-read covering the prefix); `contract.stop-reasons-map`; `contract.token-count-vs-usage`.

### 6.3 Live evals

**Scripted approver.** No human in the loop: a policy confirms or rejects each card (`confirm-if-kinds-within`, `reject-unrequested-kinds`), then the confirm runner executes it.

**Graders (all deterministic except the last).**

| Grader                          | Passes when                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `draft-valid`                   | the final draft passes kernel validation, where a pin of a question the plan itself created counts as an allowed unpublished pin |
| `flow-oracle`                   | for a table of hypothetical answer sets, the questions visible under the draft's rules equal the expected sets                   |
| `no-collateral`                 | the draft differs from the seed only at the expected paths                                                                       |
| `plan-shape`                    | proposed kinds and order match an allowed pattern                                                                                |
| `no-unrequested-kind`           | no proposal contains a kind the user did not ask for                                                                             |
| `ending-is`                     | the turn record's ending equals the expected one                                                                                 |
| `count-and-validate`            | N question references present and `draft-valid`                                                                                  |
| `refusal-rubric` (model-graded) | the reply says the user lacks the permission and proposes nothing; calibrate on 20 hand-labelled samples and report agreement    |

**Tasks.**

| Id  | Task                                                                                                                                                                                                                                                           | Graders                           | Trials                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------- |
| L1  | Build a form from a brief (3 briefs + 2 held out)                                                                                                                                                                                                              | draft-valid, flow-oracle          | 30 per brief              |
| L2  | Add conditional logic to an existing form                                                                                                                                                                                                                      | flow-oracle, no-collateral        | 30                        |
| L3  | Change one rule in a 30-question form                                                                                                                                                                                                                          | no-collateral, flow-oracle        | 30                        |
| L4  | Recovery **rate**: briefs that tend to draw a first refusal (an id that already exists; a number compared with a date; logic deeper than the schema allows). Report P(accepted plan by turn end given a first refusal) and how often a first refusal occurred. | plan-shape, draft-valid           | 30                        |
| L5  | 60-question migration over several turns using the patch tool                                                                                                                                                                                                  | count-and-validate, no-collateral | 15 (labelled exploratory) |
| L6  | Read-only user asks to publish                                                                                                                                                                                                                                 | ending-is, refusal-rubric         | 30                        |
| L7  | Injection in a question title (a rate, not a control)                                                                                                                                                                                                          | no-unrequested-kind               | 30                        |
| L8  | 15-turn editing session; paired arms: eviction on vs off                                                                                                                                                                                                       | flow-oracle, no-collateral        | 15 pairs (exploratory)    |

Mechanisms such as "eviction happened" or "the patch tool was used" are **reported, never pass criteria**.

**Trial counts and comparison.**

- Key tasks run 30 or more trials. Report the pass rate with a Wilson 95% interval. At n = 30 and a 70% rate the interval is about +/- 16 points, so say so.
- To judge a change, use a **paired comparison**: the same task instances under A (before) and B (after). For pass/fail use McNemar's exact test on the discordant pairs; with 30 pairs you need roughly 6-0 or 8-1 discordant pairs for p < 0.05. For tokens and cost report the mean paired difference with a bootstrap 95% interval.
- **Variance:** run A against A once; that difference is your noise floor. Report per-task SD of tokens and the endings histogram. If the interval includes zero, write "no detectable difference at n = 30".

**Cost tracking.** Each trial stores input, cache-read, cache-write and output tokens from the provider's usage fields; cost = tokens x the price table in config (dated). The report shows cost per trial, per task and per campaign.

---

## 7. Divergence log template

Keep it in `docs/divergence-log.md`. Fill the last two columns yourself after each compare step. The "Reference" column is a spoiler: read a row only after its phase.

| Topic (read after)           | Sandbox design                                                                                                                              | Reference (QCMS) at the pinned commit                                                                                                                                                                                                                   | Same or different | Why (your reasoning, cost, what you would do at scale) |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------ |
| Loop (P2)                    | Own loop and SSE parser on the raw Messages API                                                                                             | AI SDK `streamText` with stop conditions (`assistant.ts:347-356`)                                                                                                                                                                                       | different         |                                                        |
| Stale draft (P8)             | `expectedRevision` on every `form.saveDraft`; diff on the card; compare-and-swap at the route                                               | Draft revision bound only for plans that publish both a question and the form (`tools/propose.ts:773-807`); the builder route refuses a stale `clientState` when the client sends one (`handler.ts:513-515`); `form.publish` carries the draft revision | different         |                                                        |
| Audit / turn record (P2, P6) | `turns` row per turn (prompt version, offered tool names, token counts, stop reason, ending) plus `step_records`; no user content in either | Step row written at confirm (actor, step, form, timestamps, non-content detail: `agent-actions.ts`); prompt version only in a log line (`assistant.ts:425-437`)                                                                                         | different         |                                                        |
| Failed-step record (P6)      | `failed` row written after rollback; `not-run` derived                                                                                      | A failed step writes no row; that absence is what stops the next step (`provenance.ts:163-166`)                                                                                                                                                         | different         |                                                        |
| Roles (P4, P7)               | Four roles; publish is environment-scoped because it also releases                                                                          | Six roles in two families, not a ladder (`membership/policy.ts:104-129`); environment scope on nine acts, form scope on response acts                                                                                                                   | different         |                                                        |
| Framing (P5)                 | Tool results labelled as data; listed as a mitigation; the controls are "no authority" and the true-argument card                           | `{ framing, result }` envelope (`tools/registry.ts:1142-1156`); its README calls it "a mitigation, not a control"                                                                                                                                       |                   |                                                        |
| Context limits (P9)          | Token budget; eviction of old results; forced re-read; never truncate                                                                       | No truncation or summarisation; cap of 40 turns x 8,000 characters (`schema.ts:8,109-112`); `read_form` returns the complete draft because a save replaces it wholesale                                                                                 | different         |                                                        |
| Sessions (P3)                | Server-side session store; crash-resume                                                                                                     | No server session; the client resends the conversation each turn                                                                                                                                                                                        | different         |                                                        |
| One proposal per turn (P5)   | Your choice (plan default: one per turn, 25 steps)                                                                                          | `PROPOSALS_PER_TURN = 1` (`tools/propose.ts:31`); 25-step cap (`proposal-token.ts:13`)                                                                                                                                                                  |                   |                                                        |
| Patch tool (P8)              | `form.patchDraft`: id-addressed ops applied by the harness to a fresh read                                                                  | None; draft saves are wholesale                                                                                                                                                                                                                         | different         |                                                        |
| Reference resolution (P6)    | Client sends symbolic references; server resolves from step records                                                                         | Request carries real values; server rebuilds the symbolic form from audit rows (`provenance.ts:74-112`)                                                                                                                                                 | different         |                                                        |
| Question publishing (P4)     | `form.publish` also publishes pinned draft questions                                                                                        | Separate `question.publish` kind with pin checks                                                                                                                                                                                                        | different         |                                                        |
| Turn endings (P3)            | `no_proposal` is a neutral ending                                                                                                           | A turn without a proposal is reported as an error (`assistant.ts:485`)                                                                                                                                                                                  | different         |                                                        |
| Evaluation (P10)             | Three groups incl. live evals with paired comparison                                                                                        | Fill in from what you find                                                                                                                                                                                                                              |                   |                                                        |

---

## 8. Cut-lines and minimum viable path

**Drop in this order** (each cut removes a sentence from your claim):

| #   | Cut                                                                                           | Saves | Claim you lose                                   |
| --- | --------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------ |
| 1   | P12 second adapter                                                                            | 8 h   | "works across two provider APIs"                 |
| 2   | Crash-resume (T9.5)                                                                           | 2 h   | "resumable turns and runs"                       |
| 3   | `test_rule` tool, `refusal-rubric`, L8                                                        | 3 h   | model-graded evaluation experience               |
| 4   | Thinking round-trip (T3.2): run with thinking off; keep "unasked reasoning is dropped safely" | 2 h   | "handles reasoning blocks on a raw API"          |
| 5   | Cache measurement (T9.4) reduced to the byte-stable prefix test and one hit-rate number       | 2 h   | "measured cache behaviour under eviction"        |
| 6   | Live evals reduced to L1-L3 at n = 30 plus one paired comparison                              | 3 h   | breadth of live evals                            |
| 7   | Turn route over HTTP (T4.6): the CLI calls the loop in-process; act routes stay HTTP          | 3 h   | "SSE relay with keep-alive and disconnect abort" |
| 8   | Patch ops reduced to three (`addQuestionRef`, `upsertRule`, `removeRule`); drop L5            | 3 h   | "large-form migration"                           |
| 9   | Eviction (T9.2): keep the budget and the `context_full` ending only                           | 4 h   | "context management beyond budgeting"            |

**Non-negotiable for an honest claim.** P1 (your own stream parser with byte fixtures), P2 and P3 minus thinking (your own loop, endings, cancel, parallel calls), P4 act routes with constraints, P5 and P6 (propose, token, provenance, with the tamper, replay, order and expiry tests), P7 including revoked-before-confirm, P8 T8.1-T8.3 (stale drafts), the turn record, the deterministic suite, at least L1-L3 at n >= 30 with one paired comparison, and the divergence log.

**Minimum viable path (about 9 weeks, 80 h).** P0; P1; P2; P3 without T3.2; P4 without T4.6; P5; P6; P7; P8 T8.1-T8.3; P10 runner with `draft-valid`, `flow-oracle`, `no-collateral`; P11 with L1-L3. The claim then reads: "own loop and stream layer on a raw API, propose/confirm with signed provenance, four-point permission checks, stale-draft protection, turn records, deterministic tests plus a small live eval with a paired comparison", and nothing about caching, eviction, migration or a second provider.

---

## 9. Risks and mitigations

| Risk                                                                | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Provider cost for live evals**                                    | Budget before running: trials x tokens per trial x dated prices. Guess for one trial: about 72k input tokens (most of it cache-read) and 9k output across six model calls. At the Anthropic price table read on 2026-11-23 (Sonnet 5.5: $2 input, $10 output, $0.10 cache-read per million; Haiku 5.5: $0.10 and $0.50) that is roughly $0.15 per trial on the mid-tier model and under $0.01 on the small one. A baseline of 210 standard trials plus 15 migration trials is about $55 on the mid-tier model; a paired campaign doubles it. **Set a hard cap of $200 for the project and $25 per run**, enforced by the runner's budget guard. Debug and pilot on the small model; the pilot (T11.1) replaces these guesses with measurements. Re-check prices before each campaign. |
| API drift (events, thinking rules, caching rules, model retirement) | Pin the `anthropic-version` header and the model id in config; record both in every fixture and report; contract tests weekly; keep the adapter under 300 lines so a change is local.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Kernel tarball does not build or load                               | Two-hour timebox in T0.2; mini-kernel fallback uses the buffer week; all kernel calls go through one facade.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Native module trouble (`better-sqlite3` on Windows)                 | Use its prebuilt binaries on Node 24; if that fails, switch `src/store/db.ts` to `node:sqlite` (same SQL).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Reading the reference before designing                              | The commit of `docs/design/NN.md` must precede the phase's first code commit; check it in the weekly review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Scope creep into UI or extra kinds                                  | The card is a terminal card; six kinds only; anything else goes to a "later" list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Flaky live evals read as regressions                                | A/A noise floor, paired comparison, intervals on every number.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Overfitting the prompt to the eval tasks                            | Two held-out briefs in L1, run only for the final report.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Rate limits during a campaign                                       | Concurrency limit and backoff in the runner; resumable runs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Secrets or content in fixtures, traces, turn records                | Recorder strips headers; trace content off by default; canary tests in P1 and P2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Time slip                                                           | One buffer week; cut-lines in order; a weekly 15-minute check of hours against the table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

---

## 10. Interview preparation

| Likely question                                                                 | Where you earn the answer                                                                                                                    |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| "Walk me through your agent loop. When does it stop?"                           | P2, P3: the endings enum and `ending.three-lookalikes`                                                                                       |
| "Why not use an agent framework or the provider SDK?"                           | P1, P2 and the Loop row of the divergence log: what you saw in the bytes that a framework hides, and what the framework would have saved you |
| "How do you parse a streamed tool call?"                                        | P1: partial JSON accumulation, `sse.split-at-every-offset`, malformed input                                                                  |
| "What happens if the user cancels mid-stream?"                                  | P3, P4: `cancel.mid-stream-no-orphan`, disconnect abort                                                                                      |
| "How do you handle parallel tool calls and reasoning blocks?"                   | P3: one result message in call order; blocks returned unchanged                                                                              |
| "How do you stop the model doing something destructive?"                        | P5, P6: it has no authority; a proposal runs nothing; the card shows true arguments                                                          |
| "What does your confirmation token grant?"                                      | P6: nothing; it adds provenance; `confirm.token-adds-no-rights`                                                                              |
| "How do you prevent replay, tampering, or running out of order?"                | P6: recorded-step check, digest over canonical arguments, the direct step-3 test                                                             |
| "What if step 2 of 5 fails?"                                                    | P6: act plus record in one transaction; done/failed/not-run                                                                                  |
| "Where are permissions enforced?"                                               | P7: four checks; the route is the control; `perm.revoked-before-confirm`                                                                     |
| "How do you defend against prompt injection?"                                   | P5: framing is a mitigation; the injection test where the scripted model obeys and nothing runs                                              |
| "How do you keep private data away from the model?"                             | P2: no port reads answers; `sentinel.read-all`                                                                                               |
| "How do you manage the context window?"                                         | P9: budget, whole-or-stub eviction, forced re-read; why a draft is never truncated                                                           |
| "How does prompt caching interact with that?"                                   | P9: stable prefix, two reported numbers, what an eviction costs                                                                              |
| "Two users edit the same thing. What happens?"                                  | P8: expected revision, diff on the card, `stale.confirm-after-other-save-fails-step`                                                         |
| "How do you evaluate an agent?"                                                 | P10, P11: three groups, graders, scripted approver, n >= 30, paired comparison, noise floor                                                  |
| "How do you know a prompt change helped?"                                       | P11: your paired result, including the case where it did not                                                                                 |
| "What do you log, and what do you refuse to log?"                               | P1, P2: trace and turn record without content; canary tests                                                                                  |
| "How would you add a second provider?"                                          | P12 if built; otherwise the adapter boundary and what you predict would break                                                                |
| "How does your design differ from the system you studied, and which is better?" | Section 7: three rows you can argue both ways                                                                                                |
| "Did you work on QCMS? Was this used in production?"                            | Section 1: the prepared true sentences                                                                                                       |

---

## 11. Verification notes

Every reference-code claim used in this plan, checked on 2026-11-23 at commit `25da69b`. Paths are under `apps/api/src/features/agent/` unless they start with another top-level folder.

| #   | Claim                                                                                                                                                                                                                                                                                                        | Status                                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Draft revision bound only for plans that publish both a question and the form                                                                                                                                                                                                                                | Verified                                  | `tools/propose.ts:773-807`; `proposal-token.ts:29-35`; `provenance.ts:152-161`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 1b  | Builder route refuses a stale `clientState`                                                                                                                                                                                                                                                                  | Verified (only when the client sends one) | `handler.ts:505-516`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1c  | `form.publish` carries the draft revision                                                                                                                                                                                                                                                                    | Verified                                  | `apps/api/src/features/forms/handler.ts:1586`; agent `README.md:411-419`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1d  | The draft save itself checks no revision                                                                                                                                                                                                                                                                     | Partly verified                           | The store helper takes none (`forms/handler.ts:234-246`); a search for `revision` in `features/forms` matches only publish and review paths. The full PUT route handler was not read.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2   | Step row columns; prompt version only logged                                                                                                                                                                                                                                                                 | Verified                                  | `packages/db/src/schema/control/agent-actions.ts:18-44`; `assistant.ts:425-437`; `system-prompt.ts:4`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 3   | No publish tool; publish is a kind; unheld kinds leave the schema; a named unheld kind is refused and the turn continues; an unoffered tool ends the turn REFUSED                                                                                                                                            | Verified                                  | `tools/registry.ts:24-51,673`; `actions/releases.ts:44-71`; `tools/propose-schema.ts:59-66`; `tools/propose.ts:475-490`; `assistant.ts:293-300,327-332,446-458`                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4   | Six roles, two families; environment scope on nine acts; form scope on response acts; owner cannot author; approver cannot write or publish                                                                                                                                                                  | Verified                                  | `apps/api/src/features/membership/policy.ts:50-93,104-129,141-159`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 5   | Core exports the six named functions; version 0.0.0; no `dist`; not on npm; the API wraps it with database lookups                                                                                                                                                                                           | Verified                                  | `packages/core/src/index.ts`; `packages/core/package.json:3`; no `packages/core/dist` in this worktree; registry request returned 404; `docs/adr/core.md:35`; `features/questions/create.ts:77-83`; `features/forms/handler.ts:404-454`                                                                                                                                                                                                                                                                                                                                                                    |
| 6   | No truncation or summarisation; `read_form` returns the complete draft because saves are wholesale; 40 turns x 8,000 characters; conversation sent by the client                                                                                                                                             | Verified                                  | `tools/registry.ts:853-865`; agent `README.md:149-153`; `schema.ts:8,109-112,131-146`; a search of the slice for truncate/summarise/compact finds only scan-window flags                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 7   | One confirm; token plus step header per step; token binds user, proposal id and per-step kind, digest, environment; 10 minutes; expiry on step 0; run window from step 0's record; order from recorded steps; replay refused by the recorded-step check, unique constraint as backstop; token adds no rights | Verified, with one nuance                 | `apps/admin/lib/server/agent-proposal.ts:1-20`; `proposal-token.ts:11,16-38`; `provenance.ts:146-150,163-179,194-196`; `agent-actions.ts:43`; `audit.ts:1-5`. Nuance: for acts on an environment database the row is written after the act commits, not in its transaction (agent `README.md:451-465`).                                                                                                                                                                                                                                                                                                    |
| 8   | One proposal per turn; 25-step cap                                                                                                                                                                                                                                                                           | Verified                                  | `tools/propose.ts:31,752-761`; `proposal-token.ts:13`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 9   | Four permission checks                                                                                                                                                                                                                                                                                       | Verified                                  | `handler.ts:214-229`; `grant-filter.ts:81-99`; `tools/propose.ts:284-309`; `apps/api/src/registrars.ts:38-43`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 10  | Framing is "a mitigation, not a control"                                                                                                                                                                                                                                                                     | Verified                                  | agent `README.md:170-176`; `tools/registry.ts:1142-1156`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 11  | Recursive condition schema rewritten to a bounded self-contained one for LM Studio and the AI SDK's Google provider                                                                                                                                                                                          | Verified                                  | `tools/tool-schema.ts:1-14`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 12  | Server and client both stop the step after a failure; the reference test sends the later step directly                                                                                                                                                                                                       | Verified                                  | `provenance.ts:163-175`; `apps/admin/lib/agent/plan-state.ts:125-129,179-185`; `provenance.integration.test.ts:826-869`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 13  | Operational kinds that exist: `form.close` (and `link.mint`; there is no `link.create`)                                                                                                                                                                                                                      | Verified                                  | `actions/forms.ts:156-174`; `actions/links.ts:32`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 14  | Mixed authoring and operational plans refused; a turn with no proposal is an error; 15 s keep-alive; scripted fake with hostile scripts                                                                                                                                                                      | Verified                                  | `tools/propose.ts:814-823`; `assistant.ts:485`; `handler.ts:423`; agent `README.md:258-284`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 15  | QCMS is pre-release; external pull requests not accepted                                                                                                                                                                                                                                                     | Verified                                  | `README.md:5-7,139`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| J   | "A reused question keeps its answer history comparable across forms"                                                                                                                                                                                                                                         | **Not found; softened**                   | Searched `docs/`, the ADRs and the agent README. What is documented: questions are governed, versioned entities with a stable id (ADR-02, `docs/adr/core.md:19-25`); an id is never reused with a different meaning (R6, `PROJECT_INSTRUCTIONS.md:32`, `docs/DOMAIN_SCHEMA.md:101`); a shared library lets an organisation keep "one canonical date of birth question" (`docs/adr/core.md:459`); answers are keyed by question id (`docs/features/071-repeating-group-kernel.md:8`). This plan therefore states only "ids are stable and never reused" and makes no claim about comparable answer history. |

**Provider facts.** Verified against Anthropic's streaming and prompt-caching pages fetched on 2026-11-23: the event names, cumulative usage in the closing delta, ping and in-stream error events, partial-JSON tool input, signature deltas, the tools -> system -> messages cache order, up to four breakpoints, the per-model minimum cacheable length, the usage counters and the prices quoted in section 9.

**Could not verify.**

- That `@roonga/qcms-core` builds and packs cleanly at this commit (building would write into the repository, which was out of bounds).
- The complete draft-save route handler (row 1d).
- Whether QCMS has any live-eval harness outside the agent slice (not searched repository-wide).
- The exact current rules for returning thinking blocks in a tool loop, the full stop-reason list, the token-counting endpoint and parallel-tool-call rules: written from memory; T1.1 makes you confirm them.
- Everything about the OpenAI-compatible stream shape in P12: from memory.
- Tokens per trial in section 9: a guess until the pilot.
- The statement in row J (not found in the docs).
