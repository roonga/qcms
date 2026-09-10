---
"create-qcms-app": patch
---

Carry the question library's search bound and the settings patch's published empty-patch
rule into the scaffolded tree (issues #862, #242).

`GET /admin/questions` now caps `?search` at 200 characters, the same bound the form
library list has carried since issue #686, and answers 400 with the standard
`INVALID_REQUEST` envelope past it. `PATCH /admin/forms/{id}/settings` already refused an
all-absent body; its schema now says so in the generated OpenAPI document, as
`minProperties: 1` plus a description naming the code, so a client generated from the
document alone can see the rule.

The templates are the same files, synced by `pnpm qcms:sync-templates`, plus one new
module: `apps/admin/lib/library-search.ts`, the shared constant both library search boxes
use for their input `maxLength`.

Nothing a scaffolded project has to do about it. An adopter who has not diverged from the
templates gets the bound and the published rule; one who has replaced either schema keeps
their own.
