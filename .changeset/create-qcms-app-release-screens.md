---
"create-qcms-app": patch
---

Carry task 065 into the scaffolded app: the environment switcher, the persistent banner,
the release screens and the release routes.

A scaffolded deployment gets the same shape the repository has, because the template is a
mirror of `apps/` rather than a second implementation. What that means here: the shell
renders one global environment switcher and a banner on every page while a non-prod
environment is selected, `adminApiFetch` carries the selection to the API as
`x-qcms-environment`, the API's admin group reads it and refuses a name the deployment does
not serve, and the forms area gains a release section showing what is released to each
environment with every rollback marked.

The respondent path in the scaffold resolves **what is released to its environment** rather
than the newest published version, which is the behaviour change an adopter should know
about: a published version is served nowhere until it is released.
