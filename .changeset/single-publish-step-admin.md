---
"create-qcms-app": minor
---

Task 094: one Publish step in the forms area.

- The forms screens, the publish wizard and the assistant publish cards say Publish, never Release. `release` stays an API path, a record name and a refusal code.
- The destinations step states the fixed `prod` floor, and a refused destination names the environments a version has to be live in first.
- An operator holding Edit forms but not Publish forms sees Publish disabled with the reason beside it, on the form and in the wizard's draft source. A Publish-only holder is offered the frozen versions and not the draft.
- The wizard publishes and nothing else: the option to freeze a draft without making it live is gone. `POST /admin/forms/{id}/publish`, and a `publish-batch` with no destination, still freeze alone for an integration.
- A draft refused by second approval no longer says another person can publish it, on the destinations step or on a refused confirmation: until a held draft publish exists there is no approver step to offer.
- Availability reads Not live in the Forms list, the Operations table and the Availability screen.
- The `form.release` assistant card runs on the wizard's own batch route, so a stale confirmation is refused with `expectedWorkflowRevision` and `expectedSequence` and writes nothing.
