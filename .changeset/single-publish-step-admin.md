---
"create-qcms-app": minor
---

Task 094: one Publish step in the forms area.

- The forms screens, the publish wizard and the assistant publish cards say Publish, never Release. `release` stays an API path, a record name and a refusal code.
- The destinations step states the fixed `prod` floor, and a refused destination names the environments a version has to be live in first.
- An operator holding Edit forms but not Publish forms sees Publish disabled with the reason beside it, on the form and in the wizard's draft source. A Publish-only holder is offered the frozen versions and not the draft.
- Availability reads Not live in the Forms list, the Operations table and the Availability screen.
- The `form.release` assistant card runs on the wizard's own batch route, so a stale confirmation is refused with `expectedWorkflowRevision` and `expectedSequence` and writes nothing.
