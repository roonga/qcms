---
"create-qcms-app": minor
---

Mirror the form library's create kind into the scaffolding templates.

Creating a form is proposable from the library and from the creating screen. The screen's
own control still redirects into the builder; the card calls a non-redirecting variant of
the same action, so the same validation runs, the same route performs the same grant check,
the same audit row is written, and the new form id comes back as the one result a later
step of the plan may reference. The card shows a link to the new form, built from the
kind's own page route.
