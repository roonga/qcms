# Draft-assistant slice (task 041, ADR-25)

Flag-gated agent-assisted authoring: one bounded tool loop that proposes a draft
`FormDefinition`, relayed to the admin builder as server-sent events.

**ADR-25 in one line: the agent proposes, the kernel validates, the human
publishes.** Nothing here touches the serving path, and nothing here can reach a
respondent's answers.

Operator-facing documentation (setup, provider matrix, local-model walkthrough,
the PII boundary statement) is `docs/agent-authoring.md`.

## Routes

| Method & path | Scope (SEC-5) | Notes |
|---|---|---|
| `POST /admin/forms/:id/draft/assist` | `forms:write` | One agent turn. Body `{ conversation, clientState? }`. Answers `text/event-stream`. |

**The flag gates the mount, not a handler branch.** With
`QCMS_FLAG_AGENT_AUTHORING=none` (the default) `registerFormsAssist` registers
nothing, so the path does not exist and a request 404s - the ADR-09 shape. There
is no "feature disabled" branch a misconfiguration could reach, and a default
build's generated OpenAPI document carries no assist route. This surface is
deliberately **not** part of the frozen 027 core contract: it is optional,
flag-gated, and streams rather than returning a modelled JSON body.

## Files

| File | What it is |
|---|---|
| `types.ts` | The `DraftAssistant` port, `AssistContext`, `AssistEvent`, `AssistProposal`. The PII boundary is `AssistContext`'s shape. |
| `tools.ts` | The four-verb allowlist, the single dispatch door, and the provider tool set built from the same registry. |
| `system-prompt.ts` | The versioned system prompt, assembled from the kernel's own contracts. Reviewed like code. |
| `assistant.ts` | The `streamText` tool loop, the stop-reason mapping, and the provider selector. |
| `fake-model.ts` | The deterministic scripted model CI drives, including the hostile scripts. |
| `route.ts` / `handler.ts` / `schema.ts` | The flag-gated registrar, the SSE relay, the request schema. |

## The tool allowlist is a security control

Four verbs exist: `search_question_library`, `propose_questions`,
`propose_draft`, `validate_draft`. Publish, erase, link minting, webhook
configuration and every read of response data are **absent from the module**, so
an agent cannot call them however it is prompted, jailbroken or swapped.

Two properties hold structurally, and both are tested:

1. **One door.** `runAssistTool` is the only way a tool executes and refuses any
   name outside `ASSIST_TOOL_NAMES` before dispatch. The tool set handed to the
   provider is built from the same frozen registry, so the model is never told
   the other verbs exist. A refused call is logged and the turn produces **no
   proposal at all**.
2. **No respondent data.** Every tool draws on `AssistContext`, which carries the
   draft, a search-only library port, an advisory validation function and the
   conversation. There is no `Executor` on it, no session reader and no answer
   reader, so there is no code path from a tool to an `answers` row.

`assist.integration.test.ts` proves the second one against a real database: a
submitted answer with a sentinel value sits in the tables while a turn runs, the
exact bytes handed to the provider are captured, and the sentinel is asserted
present in the database *before* it is asserted absent from the payload.

## The advisory validation is the server's

The terminal `proposal` event always carries `issues`, computed here by calling
022's `validateDraft` over the proposed draft after the loop ends - even when the
model already called `validate_draft` itself. The UI is never handed a proposal
the agent validated for itself.

A proposed question that is not published yet validates as an unpublished pin.
That is correct rather than a gap: the agent's view of validity and the builder's
are the same view, so the human is told to publish the question rather than being
shown a proposal that would fail at publish time.

## The deterministic fake provider

`QCMS_FLAG_AGENT_AUTHORING=fake` selects a scripted `LanguageModelV3` plugged
into the **same** `streamText` loop the real providers use. Only the network call
is replaced, so CI exercises the shipped allowlist, dispatch and event mapping.

Its `default` script is adaptive rather than canned: it searches the real
question library and builds its proposal from what it finds, so an e2e run gets a
draft that references that run's own fixtures and actually publishes.

A script is selected by a `#qcms-fake:<script>` directive in a user turn:
`default`, `rogue-publish`, `rogue-erase`, `rogue-webhook`, `rogue-responses`,
`refusal`, `provider-error`, `no-proposal`. The `rogue-*` scripts exist because a
hostile model is the threat the allowlist is for, and the only honest way to test
a refusal is to have something actually attempt the forbidden call.

## Accepting a proposal

Accepting is the ordinary draft save (`PUT /admin/forms/:id/draft`) with
`agentAssisted: true`, which sets a sticky provenance flag on the draft row. The
builder header and the publish confirmation show it, so the human publishing
knows what they are signing. An ordinary later save never clears it; discarding
the draft does, because that removes the row.
