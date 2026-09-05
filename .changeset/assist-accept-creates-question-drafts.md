---
"qcms-api": minor
"qcms-admin": minor
"create-qcms-app": minor
"@roonga/qcms-observability": patch
---

Accepting an agent proposal now creates its proposed NEW questions as unpublished
question drafts, instead of discarding them (issue #823).

The defect was found live on the 041 repro stack: the assistant proposed a Registration
step with new questions, the operator accepted it, and the form draft persisted with pins
to `q_first_name@1` while the `questions` table stayed empty. The builder honestly rendered
the consequence ("Unknown / v1 / Version not found", the #769 pin-missing state), and the
assistant's own narration promised that the `DANGLING_QUESTION_REF` warning "will resolve
once the question is published" - naming a step that could not be performed, because there
was no question draft to review or publish. The operator's only recourse was re-authoring
by hand and hoping the derived id matched the pin.

ADR-25 is "the agent proposes, the kernel validates, the human publishes", and the third
clause had nowhere to happen. `POST /admin/forms/{id}/draft/assist/accept` is where it
happens now: it stores the accepted draft with its agent provenance **and** materialises
every proposed definition as an unpublished question draft, in one transaction.

Four decisions in it are worth stating, because each had a plausible alternative.

**One transaction rather than ordered-with-rollback.** Both halves are single-row inserts
through `@roonga/qcms-db` helpers that already take an `Executor`, and the slice owns the
transaction boundary (R5), so the shape the publish handler uses applies unchanged: write
the questions, write the draft, let any refusal roll the lot back. A stored draft can
therefore never pin a question whose creation failed, and no compensating delete has to be
written or tested.

**The questions slice's own door rather than a second validation route.** The kernel parse
and the authoring-boundary refusals that sit above it - the #453-era `v`-flag pattern check
among them - move to `apps/api/src/features/questions/create.ts`, and `POST
/admin/questions` and the accept now call the same `checkQuestionDefinition` and the same
`createQuestionWithFirstDraft`. Accepting is an authoring act by the human who pressed
Accept, so a proposed definition meets the boundary a hand-authored one meets. A refused
definition fails the **whole** accept, with a message naming which question and why, and
validation runs before the transaction opens so a refusal costs no database work.

**A route of its own rather than a field on `PUT /forms/{id}/draft`.** Accept creates
library questions, so it needs `questions:write` beside `forms:write`, and declaring both
on the ordinary draft save would overstate what every keystroke autosave requires. It is
also an agent-authoring capability, so it belongs behind the mount flag (ADR-09): a field
on the core draft route would have handed every `forms:write` caller a second way to create
questions whether `QCMS_FLAG_AGENT_AUTHORING` was set or not. With the flag off the accept
route 404s like the turn route, and the published admin OpenAPI document is unchanged.

**Created as drafts, never published.** Publishing stays the separate human act it was.
What changes is that the advisories now describe reality: the created versions resolve, so
the pins move from `DANGLING_QUESTION_REF` to `UNPUBLISHED_QUESTION_PIN` and stay there
until the operator publishes the questions, which is exactly the resolution step the
assistant's narration describes.

The admin builder carries the proposal's definitions into the save that stores the draft
they are pinned by, and holds them until that save actually succeeds, so a refused accept
is retried whole rather than degrading into the dangling-pin save it was refused for.

The fake provider gains a `propose-questions` script, and the browser suite gains the case
that drives it. Until now `propose_questions` had **no e2e consumer at all**: every scripted
proposal pinned questions the run had already published, so an accept that silently
discarded the proposed definitions looked green from the deterministic lane. That is the
same blind spot issue #820 found on the tool schemas, and the fix is the same one: have the
fake provider actually call the verb. The script proposes one question and a step pinning
it; its id suffix comes from a `#qcms-fake-new:<word>` directive, because accepting
_creates_ the question and an id is never reused (R6), so a canned id would work once
against the shared harness database and fail every run after.

`@roonga/qcms-observability` classifies the accept path's two log records. Both go in
`SAFE_EVENTS`: how often a proposal is accepted and how many question drafts it produced,
and how often the authoring boundary refuses one outright, are both things an operator
counts, and a rising refusal rate is the only visible signal that a configured model is
producing definitions the kernel will not take. Every attribute either record sets
(`formId`, `createdQuestions`, `questionId`, `issues`) is absent from `SAFE_ATTRIBUTES` and
is deleted on export, so the event name and its count are all that leave the process -
which matters most for `questionId` on a refusal, an id a model invented and read
positionally off a definition that failed to parse.
