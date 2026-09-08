---
"create-qcms-app": patch
---

Carry the form library's new search, status filter and sort into the scaffolded tree
(issue 686).

`GET /admin/forms` now accepts `status`, `search` (over the slug and any locale of the form
title) and `sort` (`slug-asc`, `slug-desc`, `published-desc`, `published-asc`, defaulting to
slug ascending), and the admin's `/forms` screen sends all three from a native GET form so a
filtered library is a URL. The templates are the same files, synced by
`pnpm qcms:sync-templates`, plus one new module: `apps/admin/lib/forms/list-filters.ts`,
which reads the list's URL state.

Nothing a scaffolded project has to do about it. An adopter who has not diverged from the
template gets the controls; one who has replaced either file keeps their own.
