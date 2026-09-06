# Draft-assistant slice (task 041, ADR-25)

Flag-gated agent-assisted authoring: one bounded tool loop that proposes a draft
`FormDefinition`, relayed to the admin builder as server-sent events.

**ADR-25 in one line: the agent proposes, the kernel validates, the human
publishes.** Nothing here touches the serving path, and nothing here can reach a
respondent's answers.

Operator-facing documentation (setup, provider matrix, local-model walkthrough,
the PII boundary statement) is `docs/agent-authoring.md`.

## Routes

| Method & path                               | Scope (SEC-5)                    | Notes                                                                                     |
| ------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------- |
| `POST /admin/forms/:id/draft/assist`        | `forms:write`                    | One agent turn. Body `{ conversation, clientState? }`. Answers `text/event-stream`.       |
| `POST /admin/forms/:id/draft/assist/accept` | `forms:write`, `questions:write` | The human's Accept. Body `{ definition, newQuestions }`. Answers a saved-draft JSON body. |

**The flag gates the mount, not a handler branch.** With
`QCMS_FLAG_AGENT_AUTHORING=none` (the default) `registerFormsAssist` registers
nothing, so the path does not exist and a request 404s - the ADR-09 shape. There
is no "feature disabled" branch a misconfiguration could reach, and a default
build's generated OpenAPI document carries no assist route. This surface is
deliberately **not** part of the frozen 027 core contract: it is optional,
flag-gated, and streams rather than returning a modelled JSON body.

## Files

| File                                    | What it is                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`                              | The `DraftAssistant` port, `AssistContext`, `AssistEvent`, `AssistProposal`. The PII boundary is `AssistContext`'s shape. |
| `tools.ts`                              | The four-verb allowlist, the single dispatch door, and the provider tool set built from the same registry.                |
| `system-prompt.ts`                      | The versioned system prompt, assembled from the kernel's own contracts. Reviewed like code.                               |
| `assistant.ts`                          | The `streamText` tool loop, the stop-reason mapping, and the provider selector.                                           |
| `fake-model.ts`                         | The deterministic scripted model CI drives, including the hostile scripts.                                                |
| `route.ts` / `handler.ts` / `schema.ts` | The flag-gated registrar, the SSE relay, the request schema.                                                              |

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
present in the database _before_ it is asserted absent from the payload.

## The advisory validation is the server's

The terminal `proposal` event always carries `issues` **and** `warnings`, both
computed here by calling 022's `validateDraft` over the proposed draft after the
loop ends - even when the model already called `validate_draft` itself. The UI is
never handed a proposal the agent validated for itself.

Two lists rather than one because issue #123 split the advisory channel: `issues`
is why a publish would be refused, `warnings` is a draft that would publish and
may not behave as written. Both travel, and the panel renders both, so a proposal
card can never read "Validation passes" over a draft the builder's own validation
panel will flag one Accept later. The tool results carry both for the same reason
in the other direction: a model that cannot see a warning cannot act on it.

A proposed question that is not published yet validates as an unpublished pin.
That is correct rather than a gap: the agent's view of validity and the builder's
are the same view, so the human is told to publish the question rather than being
shown a proposal that would fail at publish time. Since issue #823 that sentence
is also true after the accept, because the accept creates the draft the operator
is told to publish; before it, the pin resolved to nothing at all and the advice
named a step nobody could perform.

## The deterministic fake provider

`QCMS_FLAG_AGENT_AUTHORING=fake` selects a scripted `LanguageModelV3` plugged
into the **same** `streamText` loop the real providers use. Only the network call
is replaced, so CI exercises the shipped allowlist, dispatch and event mapping.

Its `default` script is adaptive rather than canned: it searches the real
question library and builds its proposal from what it finds, so an e2e run gets a
draft that references that run's own fixtures and actually publishes.

A script is selected by a `#qcms-fake:<script>` directive in a user turn:
`default`, `rogue-publish`, `rogue-erase`, `rogue-webhook`, `rogue-responses`,
`refusal`, `provider-error`, `provider-rejected`, `tool-error-recovered`,
`propose-questions`, `no-proposal`, `length`, `step-limit`. The `rogue-*` scripts
exist because a hostile model is the threat the allowlist is for, and the only
honest way to test a refusal is to have something actually attempt the forbidden
call.

`propose-questions` is the one script that calls `propose_questions`, and it was
added with issue #823's fix. Until then the verb had **no e2e consumer at all**:
every scripted proposal pinned questions the run had already published, so an
accept that silently discarded the proposed definitions looked green from the
deterministic lane. A tool the fake provider never calls is a tool the browser
suite cannot vouch for, which is the same blind spot issue #820 found on the tool
schemas. The script proposes one question and a step that pins it; the id suffix
comes from a `#qcms-fake-new:<word>` directive, because accepting **creates** the
question and a `questionId` is never reused (R6), so a canned id would work once
against the shared harness database and fail every run after.

## Accepting a proposal

Accepting a proposal that only re-pins **existing library questions** is the
ordinary draft save (`PUT /admin/forms/:id/draft`) with `agentAssisted: true`,
which sets a sticky provenance flag on the draft row. The builder header and the
publish confirmation show it, so the human publishing knows what they are
signing. An ordinary later save never clears it; discarding the draft does,
because that removes the row.

Accepting a proposal that carries **new question definitions** goes to
`POST /admin/forms/:id/draft/assist/accept` instead, and that route is issue
#823's fix. It stores the draft and materialises every proposed definition as an
**unpublished question draft** in the library, in one transaction.

Three things about it are decisions rather than details.

**One transaction, not ordered-with-rollback.** Both halves are single-row
inserts through `@roonga/qcms-db` helpers that take an `Executor`, and the slice
owns the transaction boundary (R5), so the publish handler's shape applies here
too: open a transaction, write the questions, write the draft, let a refusal roll
the lot back. A stored draft therefore never pins a question whose creation
failed, and no compensating delete has to be written or tested.

**The questions slice's own door, not a second one.** Every proposed definition
goes through `checkQuestionDefinition` in `features/questions/create.ts`, which
is the kernel parse plus the authoring-boundary refusals the kernel deliberately
does not carry - the #453-era `v`-flag pattern check among them. `POST
/admin/questions` calls the same function and the same
`createQuestionWithFirstDraft`. An accept is an authoring act by the human who
pressed Accept, so it meets the boundary a hand-authored question meets, and a
refused definition fails the **whole** accept with a message naming which
question and why. Validation runs before the transaction opens, so a refusal
costs no database work.

**A route of its own, not a field on the draft save.** Accept creates library
questions, so it needs `questions:write` beside `forms:write`; declaring both on
`PUT /forms/{id}/draft` would overstate what every keystroke autosave requires.
And an agent-authoring capability belongs behind the mount flag: a field on the
core draft route would have handed every `forms:write` caller a second way to
create questions whether `QCMS_FLAG_AGENT_AUTHORING` was set or not.

The advisories then describe reality. The created drafts resolve, so the pins
stop being `DANGLING_QUESTION_REF` and become `UNPUBLISHED_QUESTION_PIN` until
the operator publishes them, which is the resolution step the assistant's own
narration promises. The builder grid shows an accepted-but-unpublished pin the
way it shows any unpublished pin, and it resolves fully once the operator
publishes the question from the library screen.
