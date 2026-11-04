---
"qcms-api": patch
"qcms-admin": patch
---

Bind the builder's publish card to the saved draft it was built from (Code Owner,
2026-11-04, issue #1205 follow-up).

The card publishes the question versions the form's **saved** draft pins unpublished, and
Confirm checked the environment and each step's argument digest but not the draft, so a pin
removed between the proposal and Confirm was still published inside the ten-minute window.
A proposal whose steps were checked against that set now records the draft's
`form_drafts.revision` in the signed token, and the provenance check refuses every step of
such a plan with `AGENT_PROPOSAL_DRAFT` unless the saved draft still carries it. The card
reports that the draft has changed and asking again is the only way on; nothing is
published and no audit row is written.

It fails closed on a moved revision, a draft that has been published or deleted, a token
binding a revision but naming no form, and a deployment that cannot read the draft. A plan
no step of which was checked against the pin set records no revision and is unaffected, so
an ordinary plan is not refused by a draft save.

Publishing the form deletes the draft, so `propose_plan` refuses a bound plan carrying a
further token step after `form.publish`: that step could only ever be refused, for a draft
nobody touched.

SEC-17 in `docs/SECURITY_DESIGN.md` and section 4 of `docs/agent-authoring.md` carry the
ruling.
