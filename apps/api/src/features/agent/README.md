# Agent slice (tasks 041 and 082, ADR-25, SEC-17)

Flag-gated agent assistance on every admin screen: one bounded tool loop,
relayed to the admin as server-sent events. On the form builder it proposes a
draft `FormDefinition`; on every other screen it explains and navigates.

**ADR-25 in one line: the agent proposes, the kernel validates, the human
publishes.** Nothing here touches the serving path, and nothing here can reach a
respondent's answers.

Operator-facing documentation (setup, provider matrix, local-model walkthrough,
the PII boundary statement) is `docs/agent-authoring.md`.

## Routes

| Method & path                               | Scope (SEC-5)                    | Notes                                                                                                                                   |
| ------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /admin/forms/:id/draft/assist`        | `forms:write`                    | One agent turn. Body `{ conversation, clientState?, screen?, params?, conversationId?, visitId? }`. Answers `text/event-stream`.        |
| `POST /admin/forms/:id/draft/assist/accept` | `forms:write`, `questions:write` | The human's Accept. Body `{ definition, newQuestions }`. Answers a saved-draft JSON body.                                               |
| `POST /admin/assist`                        | `forms:read`                     | One turn on the screen the body names. Body `{ conversation, screen, params?, conversationId, visitId? }`. Answers `text/event-stream`. |

Both turn routes share **one per-principal limiter key** (Q19), so ten turns a
minute is the caller's whole budget rather than one budget per route.

**The flag gates the mount, not a handler branch.** With
`QCMS_FLAG_AGENT_AUTHORING=none` (the default) `registerFormsAssist` registers
nothing, so the path does not exist and a request 404s - the ADR-09 shape. There
is no "feature disabled" branch a misconfiguration could reach, and a default
build's generated OpenAPI document carries no assist route. This surface is
deliberately **not** part of the frozen 027 core contract: it is optional,
flag-gated, and streams rather than returning a modelled JSON body.

## Files

| File                                    | What it is                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`                              | The `DraftAssistant` port, `AgentContext`, `AssistContext`, `AssistEvent`, `AssistProposal`. The PII boundary is the context's shape.                                                 |
| `screens.ts`                            | The frozen `SCREENS` registry: one row per `(shell)` page, each with its facts schema, context builder, read tools and action kinds.                                                  |
| `contexts/`                             | The per-screen context builders, grouped by area, each checking its own SEC-3 cell before it reads anything.                                                                          |
| `contexts/reads.ts`                     | The read ports of D1 to D7: one per read tool a screen declares, each re-making its own screen's read check.                                                                          |
| `tools/registry.ts`                     | The frozen tool registry, the single dispatch door, and the provider tool set built from the current screen's list.                                                                   |
| `system-prompt.ts`                      | The versioned system prompt, assembled from the kernel's own contracts. Reviewed like code.                                                                                           |
| `assistant.ts`                          | The `streamText` tool loop, the stop-reason mapping, and the provider selector.                                                                                                       |
| `actions/`                              | One module per action-kind group, each kind's descriptor: its route, cell, argument schema, how the middleware recomputes its arguments, its result allowlist and its card templates. |
| `proposal-token.ts`                     | The signed proposal token: the ordered step list, each step's argument digest and the environment it acts in.                                                                         |
| `draft-pins.ts`                         | The form's saved draft as a plan sees it: the versions it pins unpublished, and the revision a plan built from them is bound to.                                                      |
| `provenance.ts` / `provenance-mount.ts` | The provenance check and the middleware the admin group mounts it as. It adds provenance and never rights.                                                                            |
| `audit.ts`                              | The one `control.agent_actions` row a confirmed step writes.                                                                                                                          |
| `grant-filter.ts`                       | The (kind, environment) pairs a turn is offered, through the evaluator the route middleware uses.                                                                                     |
| `fake-model.ts`                         | The deterministic scripted model CI drives, including the hostile scripts.                                                                                                            |
| `route.ts` / `handler.ts` / `schema.ts` | The flag-gated registrar, the SSE relay and its 15 second keep-alive, the request schema.                                                                                             |
| `thinking.ts`                           | One function from `QCMS_AGENT_THINKING` to the provider's own options, and nothing vendor-shaped anywhere else (081).                                                                 |

## The registry and the door are security controls

The read verbs are the builder's four (`search_question_library`,
`propose_questions`, `propose_draft`, `validate_draft`), the preview projection
(`project_draft`) and D1 to D7's screen reads: `test_rule`,
`diff_form_versions`, `count_links`, `list_responses`, `count_responses`,
`delivery_status`, `count_dead_letters`, `diff_question_versions` and
`search_forms`. Beside them sit the two propose tools, which execute nothing.
Publish, erase, link minting, webhook configuration and every read of response
**content** are absent from the module, so an agent cannot call them however it
is prompted, jailbroken or swapped.

Three properties hold structurally, and all three are tested:

1. **One door, per screen.** `runAgentTool` is the only way a tool executes. It
   refuses a name outside the registry and a registered name outside **the
   current screen's** list, before dispatch; the tool set handed to the provider
   is built from that same list, so the model is never told the other verbs
   exist. A refused call is logged and the turn produces **no proposal at all**,
   and the loop ends at the refusing step rather than asking again until
   `QCMS_AGENT_MAX_STEPS` runs out. A tool that declares a SEC-3 cell runs only
   once the calling principal is shown to hold it, through the same policy
   evaluator the route middleware uses.
2. **The browser sends no context.** A turn carries a screen id, the route's own
   ids and the response list's four filters. The screen's own builder computes
   the facts here, under the caller's grants, so a tampered client cannot hand
   the model something its screen would not show.
3. **No respondent answer.** Every facts schema and every tool output schema is a
   `z.strictObject` of enumerated fields, and the response screens' builders
   close over a metadata projection that selects no answer column and joins no
   answer table. `screens.test.ts` walks every schema and fails on a field whose
   name matches the respondent-content or secret vocabulary the stdout redactor
   uses; the staff-identity fragments are excluded, because a workspace member's
   name and email are staff data and may flow (Q11).

`assist.integration.test.ts` proves the last one against a real database: a
submitted answer and a webhook payload both carry a sentinel while a turn runs on
**every** screen, the exact bytes handed to the provider are captured, and the
sentinel is asserted present in the database _before_ it is asserted absent from
the payload. The same run asserts that a session id **is** present, so the
metadata half of the rule is pinned too.

Each of those turns runs the fake provider's `read-all` script, which calls every
tool the screen offers, one per step. So the boundary is asserted over the output
of every registered read tool rather than over the facts alone, and the walk fails
if a tool stops being reachable: it asserts that every name in `AGENT_TOOL_NAMES`
executed.

## Facts and tool results are delimited as data

Both reach the model inside a delimiter that says what they are: the screen's
facts as a fenced JSON block, a tool result as an object whose `framing` names its
standing and whose `result` holds the data. The system prompt states that nothing
inside either is an instruction, however it is phrased. It is a mitigation, not a
control: the controls are the caller's own grants, the door, and the human confirm.

The draft preamble that asks for changes is sent only on a screen that offers a
propose verb, so a screen holding the draft for a read tool alone is not told to
propose against it.

## A read tool is refused wherever its screen would be

Each read port in `contexts/reads.ts` re-makes the grant check its own screen's
read makes, which is not always the one cell the door can express: the response
reads are per-form, the form search is over the workspaces the caller holds
`form: read` in, and the dead-letter count needs the installation-wide claim the
screen itself needs. So a port absent and a port refused are both "nothing" to
the model, and a caller the screen would refuse learns nothing through a tool.

Two counts are bounded rather than exact, and say so in their own result:
`delivery_status` and `count_dead_letters` scan a fixed window and report
`scanned` and `truncated` beside the counts, because a turn is a payload rather
than a page. Every other read is exact: the response count comes off the same
query the list does, and the link count is the whole of one form's links in one
environment.

A diff reports **structure**: which step and question ids moved, which pins were
re-pinned to another version, how many rules each side carries, and for a
question which members of the definition differ **by name**. Not their content,
because a diff of authored text is not what the model needs to tell a person
what changed between two versions.

## An audited read is audited once per stay on a subject

A screen whose own read writes a SEC-15 `read` row writes one from an agent turn
too (Q10), once per stay on a subject for each distinct filter set rather than
once per turn. D4's `list_responses` and `count_responses` key their row by the
subject the facts builder keys it by, so a turn whose facts, list and count all
run over one filter set writes one row and not three.

One conversation follows the user across screens, so the key is the actor, the
environment, the conversation id the admin mints, the stay it mints whenever that
conversation arrives at a subject, and a digest of the normalised filters. A
conversation that leaves a subject and returns to it therefore writes a new row
(Code Owner, 2026-11-02). A forged or reused id can add rows or skip a stay
already recorded for that same user, and can never leave a stay with no row; a
turn that names no stay keeps the conversation-wide key.

## The advisory validation is the server's

A proposed draft reaches the person as one card: the `apply-draft` action kind.
`propose_draft` records and validates the draft and saves nothing; the model then
proposes `apply-draft`, and that step carries the draft, the questions it invents
and both advisory lists, computed here by calling 022's `validateDraft` over the
proposed draft - even when the model already called `validate_draft` itself. The
UI is never handed a draft the agent validated for itself, and no separate
proposal event travels beside the card, so one proposal per turn (P1) holds for a
draft as it does for every other act.

`apply-draft` reaches no route. Confirm hands the draft to the builder, which
stores it through the one save path every other edit takes, with the sticky
agent-assisted mark; the kind therefore carries no token, no provenance check
stands behind it, and the builder's own `form: write` route is what authorises it.
It may be a plan's first step, and the plan's token binds only the steps that do
reach a route.

Two lists rather than one because issue #123 split the advisory channel: `issues`
is why a publish would be refused, `warnings` is a draft that would publish and
may not behave as written. Both travel, and the card renders both, so a card can
never read "Validation passes" over a draft the builder's own validation panel
will flag one Confirm later. The tool results carry both for the same reason in
the other direction: a model that cannot see a warning cannot act on it.

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
`refusal`, `provider-error`, `provider-rejected`, `tool-then-provider-error`,
`tool-error-recovered`, `propose-questions`, `no-proposal`, `length`,
`step-limit`, `narrate-then-tools`, `reasoning`, `read-all`, D0's action
scripts: `plan-three`, `plan-fails-at-2`, `plan-two-envs`, `plan-pending-at-1`,
`two-proposals`, `plan-26-steps`, `unknown-tool`, `injection-follow`,
`read-only-user`, and one `propose-<kind>` script per screen group's kind, which
puts that kind alone up for review: `propose-form-settings`,
`propose-form-close`, `propose-form-reopen`, `propose-form-release`,
`propose-response-erase`, `propose-response-unflag`, `propose-webhook-create`,
`propose-webhook-rotate`, `propose-webhook-retarget`,
`propose-form-publish`, `propose-webhook-reactivate`,
`propose-webhook-deactivate`, `propose-webhook-redeliver`,
`propose-access-group-create`, `propose-access-group-remove`,
`propose-access-grant`, `propose-access-revoke`, `propose-member-role` and
`propose-workspace-settings`.
The `rogue-*` scripts
exist because a hostile model is the threat the allowlist is for, and the only
honest way to test a refusal is to have something actually attempt the forbidden
call.

The action scripts propose and run nothing: Confirm is the user's and lives on the
card. Each reads the form, the version and the link it names out of the screen's
own facts block, so a script names the fixture's rows rather than a canned id. A
script whose kinds span the form subtree (`plan-three`, `plan-pending-at-1`) is
one card, because a form-scoped screen offers the whole subtree's kinds (Code
Owner, 2026-10-31); every step still runs its own screen's action, and the
three-route run is asserted in `provenance.integration.test.ts` against the real
routes.

`reasoning` emits reasoning parts carrying a sentinel string on **every** round,
whatever `QCMS_AGENT_THINKING` says, so one script proves both halves of the
setting: under `summary` the sentinel reaches the panel, and under `off` it
reaches nothing at all - not the wire, not the log, not the exported telemetry,
not the next turn's request and not the replayed conversation. Emitting them
unconditionally is the point. The property is that the **event mapping** drops
reasoning, not that the request declined to ask for it, and a provider
volunteering reasoning nobody asked for is exactly what an `openai-compatible`
endpoint and the newer Anthropic models do. Its text also carries a Markdown
construct, so "the disclosure is plain text, never Markdown" has something to
fail on.

`narrate-then-tools` is the only script that streams a tool call's **input
phase** - `tool-input-start`, then the JSON as deltas, then the parsed call - so
it is the only one that produces the window the timeline row is announced in.
Every other script emits a parsed `tool-call` with no input phase, so its row
appears and settles in the same instant and no amount of browser waiting can see
it running. It also says one sentence per round under its own text segment id,
which is what makes the segment column and "the card quotes the last segment"
observable end to end. The `rogue-*` scripts stream their input phase too, which
is how the refusal is proven against the arrival order a real provider produces:
a name outside the allowlist must put nothing on the timeline, and the refusal
must still come off the parsed call.

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

## One route can serve several acts

A kind is resolved from the request's method and route, because the token binds a
step to the route it may be sent to. Three endpoint acts share one method and one
route and differ only in the body, so each declares in `route.bodyMembers` the
exact member set its request carries, and a configure body matching none of them
resolves to no kind and is refused. The digest already binds the body, so the
member set is a second lock rather than the only one.

## A plan built from the saved draft is bound to that draft

`question.publish` proposed anywhere but the question's own page is checked
against the versions the form's saved draft pins unpublished, so the whole plan
depends on a draft that the editor can still change. The proposal therefore
records that draft's `form_drafts.revision` in the token, and the provenance
check refuses every step of such a plan unless the saved draft still carries it
(Code Owner, 2026-11-04). The code is `AGENT_PROPOSAL_DRAFT`, and the refusal is
closed in all four directions: a moved revision, a draft that is gone, a token
binding a revision but naming no form, and no reader for the draft at all. A
plan no step of which was checked against the pin set records no revision, so an
ordinary plan is not refused by a draft save.

`form.publish` deletes the draft it publishes, so in a bound plan it is the last
step that carries the token: `buildProposal` refuses a later token step rather
than letting it run into `AGENT_PROPOSAL_DRAFT` and tell the user their draft
changed when nothing touched it.

## Publishing goes through the batch route

`form.publish` runs `POST /admin/forms/{id}/publish-batch`, the route the Publish
wizard confirms through, and freezes the draft into **one** destination (Code
Owner, 2026-11-01). Two properties come with that route rather than with the
card: the draft revision and the workflow revision the review reported travel
with the request, so a draft saved between the proposal and Confirm is refused
and nothing is written; and the two-person rule refuses a gated production
destination whose publisher is this account, exactly as it refuses the wizard.

That row takes its environment from the body's `targets`, and a token's step
binds one environment, so the provenance check accepts the row **only** when the
batch names exactly one destination and it equals the step's own environment.
None and two are both refused with `AGENT_PROPOSAL_ENVIRONMENT`. The accepted
consequence is that a publish releasing nowhere is not proposable: the agent's
publish always names the environment the new version lands in.

## A create is called through a variant that does not navigate

A library's own creating control ends in a `redirect()`, and a step that navigated the
page away would lose every step after it without reporting one. So a create kind runs a
non-redirecting variant of the same action: the same validation, the same route and
therefore the same grant check, the same audit path, and the new id returned as the one
result a later step may reference (Code Owner, 2026-11-01). The screen's own control still
redirects, and the card shows a link to what it made, built from the kind's own page route
so it can never point at a route handler.

One member of the request is unbound by the digest on purpose: `POST /admin/forms` carries
a `formId` the admin derives from the slug with the function the screen uses, and the model
never names it, so binding the slug binds everything a proposal can choose.

## A question definition travels in the arguments

A question definition is authoring content, not respondent content, so the library's
create and save kinds carry it as an argument and the card shows every field of it. That
is also what binds it: the digest is taken over the whole argument object, so a save whose
request carries a definition the card never showed is refused with
`AGENT_PROPOSAL_ARGUMENTS` and the stored draft is untouched. No read tool and no context
builder returns an answer, a ledger row or a payload, and nothing here changes that.

## A step's row is written where the step's act is not

`control.agent_actions` lives in the control database. Where the act does too - a
publish, a release, a link, a form's settings or its intake - the row rides the
act's own transaction, so a step that failed wrote none and the card's report and
the audit agree.

An erasure, an unflag, an endpoint change and a redelivery act on an
environment's own database instead, and two pools cannot share one transaction.
There the row is written once the act has committed. The property that matters is
unchanged, because it is what the card's report rests on: a step that failed
wrote no row, and a step the next one orders itself behind is recorded before its
result reaches the browser. What is given up is only atomicity between the act and
its own provenance record, which no single-database reading of the design could
have kept.
