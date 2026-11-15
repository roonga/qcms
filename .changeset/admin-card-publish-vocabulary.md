---
"create-qcms-app": patch
---

Action cards and the agent audit say publish, never release, for a form.

- A publish card reads "Publish {form} to {environment}", and publishing an existing version
  reads "Publish version {version} of {form} to {environment}".
- The draft-save and apply-draft cards say they publish nothing, and the reopen consequence
  names the version published in that environment, matching its own dialog.
- "release" joins the card vocabulary guard, exempt only for the withheld-event act, which its
  own screen control also calls releasing.
