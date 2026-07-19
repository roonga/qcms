# 041 — Agent-assisted form building (flag-gated, off the launch gate)

**Stage:** 8a · **App:** `apps/api` (`features/forms/assist`) + `apps/admin` · **Depends on:** 033 (builder), 034 (preview), 022 (draft/validate API), 027 (admin OpenAPI — the tool manifest)
**References:** **ADR-25** (governing) · ADR-24 (flag pattern) · ADR-03 (the DSL is machine-emittable) · `DOMAIN_SCHEMA.md` §2–3 · R2, R4 · SEC-7/SEC-8 (provider key handling) · **Wireframe:** `docs/wireframes/admin-agent-panel.md` (042)
**External input required:** an LLM provider account for live testing (BYO `QCMS_AGENT_API_KEY`); CI uses the deterministic fake provider only.

## Context

The agent proposes, the kernel validates, the human publishes (ADR-25). An authoring agent is just another author emitting domain JSON — question definitions and a draft `FormDefinition` — through the same validation gauntlet humans face. The serving path is untouched; this task never touches `evaluateRules`, snapshots, or the portal. **038's launch gate does not depend on this task** — launch may proceed with the flag dark.

## Deliverables

**API (fetch-pure slice, `/admin` group):**

- `DraftAssistant` provider adapter interface: `assist(context: { draft, questionLibrary, conversation }, signal): AsyncIterable<AssistEvent>` — vendor-shaped like 026's `ChallengeVerifier`. Implementations: `none` (routes not mounted), `anthropic` (reference), and a **deterministic fake** for tests (scripted proposals from fixtures).
- **Toolchain: vendor-agnostic via the Vercel AI SDK** (`ai` + `@ai-sdk/*` provider packages — Official-tier under CONTRIBUTING; fetch-based, R4-compatible). One `DraftAssistant` implementation built on `streamText` with Zod-native tool definitions — the same Zod schemas that generate the OpenAPI docs, one schema language end to end. Provider selection is **configuration, not code**: `QCMS_FLAG_AGENT_AUTHORING` names the provider id (`anthropic` is the documented reference; `openai`, `google`, and OpenAI-compatible endpoints — incl. local models — work the same way), with `QCMS_AGENT_MODEL` and `QCMS_AGENT_API_KEY` (+ optional base URL) alongside. Step limit bounds the loop; streaming feeds the slice's SSE relay; provider-specific capabilities (e.g. Anthropic prompt caching on the large frozen system prompt) go through the SDK's per-provider options passthrough. Handle refusal/length stop reasons explicitly. **Not** LangChain/LangGraph (framework weight and abstraction churn for what is one bounded tool loop), **not** the Claude Agent SDK (Claude Code's harness with filesystem/bash tools — wrong tool surface), **not** Managed Agents (a hosted sandbox can't call our kernel; core features stay self-hosted). `DraftAssistant` remains the qcms-owned seam above the AI SDK, so the abstraction itself is swappable.
- Selected by `QCMS_FLAG_AGENT_AUTHORING` (`none` default | `anthropic`); `QCMS_AGENT_API_KEY` required by 017's config validation iff enabled; key joins the SEC-7 inventory (redaction rules apply — SEC-8).
- `POST /admin/forms/:id/draft/assist` — body: conversation turns + client state token; streams (SSE) proposal progress; the completed proposal is `{ proposedDraft, newQuestions[], rationale, issues: PublishError[] }` where `issues` comes from running 022's advisory validation server-side before returning — the agent never hands the UI an unvalidated proposal silently.
- **Tool allowlist (enforced server-side, not by prompt):** search the question library, propose new draft question definitions, propose the draft `FormDefinition`, run validation. **Never**: publish, erase, mint links, webhook config, read responses. Respondent data never enters the provider payload (PII boundary — the tool surface makes this structural). An agent tool call outside the allowlist is rejected and logged.
- System prompt assembled from the domain contracts (question types, canonical `AnswerValue` encodings, the DSL incl. ADR-16 forward-only targeting and ADR-21 containment operators) — committed to the repo and versioned; prompt changes are reviewed like code.
- Per-deployment rate limit on the assist endpoint; token usage logged (counts, not content).
- **Model switching is pure configuration:** `QCMS_FLAG_AGENT_AUTHORING` (provider id) + `QCMS_AGENT_MODEL` + `QCMS_AGENT_API_KEY` + optional `QCMS_AGENT_BASE_URL`. **Locally hosted models are first-class:** the OpenAI-compatible provider covers Ollama, vLLM, LM Studio, llama.cpp-server, etc. (base URL + model name; key optional for local endpoints — config validation relaxes the key requirement iff a local base URL is set). Switching provider or model is an env change + restart (ADR-24 semantics); no code changes, no redeploy of images.

**Admin UI (ordinary React on the a2ra kit — ADR-22):**

- Chat panel in the form builder (033's screen), visible only when the deployment flag is on: describe the form → streamed proposal → **diff view** (steps/questions/rules added or changed vs the current draft) → *Accept into draft* (never auto-publish) → validation issues render inline exactly as 033's live validation does → iterate conversationally.
- Draft provenance marker ("draft includes agent-assisted changes") on the builder and the publish confirmation — the human publishing knows what they're signing.
- Empty/error states: provider down, rate-limited, proposal rejected by validation.

**Tests (ADR-23 layers):**

- Slice tests with the fake provider: proposal → advisory issues attached; allowlist enforcement (a scripted rogue tool call to publish → rejected, logged); flag `none` → routes absent (404, mount-flag style); flag on without key → boot fails fast.
- Playwright e2e with the fake provider: chat "life-insurance signup where smokers get a follow-up" → proposal diff appears → accept → validation green → publish through the normal 034 flow → preview walks the branch. Live-provider smoke test exists but is env-gated and manual — never in CI.

## Exit criteria

1. Flag `none` (default): no assist routes mounted, no chat UI rendered, boot requires no provider key.
2. Flag on without `QCMS_AGENT_API_KEY`: fails fast at boot with a readable message (no secret echo).
3. Playwright fake-provider e2e green; the accepted form publishes through the unchanged human publish flow.
4. Allowlist test: agent-initiated publish/erase/webhook attempts rejected server-side; responses endpoints unreachable from the tool surface.
5. System prompt + provider docs committed (`docs/agent-authoring.md`: setup, BYO-key, provider/model switching matrix, a **local-model walkthrough** (e.g. Ollama via the OpenAI-compatible provider), what the agent can and cannot do, PII boundary statement — including that with a local model, form structure never leaves the deployment at all).
6. 040's security checklist gains the assist surface (provider-key handling, egress note, allowlist tests) when the flag is on in any tested composition.

## Out of scope

Adaptive serving / `StepResolver` (Phase 4 — the serving path never sees an LLM, Project Goal §8), auto-publish, agent access to response data (never — PII boundary), fine-tuning or local models (adapter seam accommodates them later), multi-turn memory beyond the session.
