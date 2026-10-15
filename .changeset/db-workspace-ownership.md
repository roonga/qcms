---
"@roonga/qcms-db": minor
---

Add the workspace reference ADR-41 names: `control.forms.workspace_id` and
`control.questions.workspace_id`, each `NOT NULL` with no default and each referencing the
`organization` row a workspace **is** (task 068, Q32). A form or a question cannot exist
without exactly one workspace, and the column is what enforces that rather than a backfill
or an authoring convention.

**The migration adds no table, so it carries no grant block.** A grant on a table covers
the columns added to it later, so `qcms_app_control`'s DML and each `qcms_app_<env>`'s
`SELECT` on `control.forms` already reach the new column; migration 0001's rule is about a
new table and does not apply to a column. Neither `NOT NULL` column takes a default or a
backfill, which is green field (Q22) rather than an oversight: an operator holding a
populated development database from before this migration drops it and migrates a new one,
which is the instruction section 4a of `plan/environments-and-workspaces.md` already gives.

Two constraints come with it. **`forms_slug_unique`** makes form slugs unique
installation-wide rather than per workspace, which is what lets `/f/{slug}` carry no
workspace segment and keeps a slug from changing meaning by context; `questions_slug_unique`
already existed. **`organization_shared_uq`** is a partial unique index over `isShared`
where it is true, so at most one workspace is the installation's shared question library and
"a form may pin its own workspace's questions or the shared workspace's" has one answer.

New query helpers: `listWorkspaces`, `listActiveWorkspaces`, `getWorkspace`,
`getWorkspaceBySlug`, `getSharedWorkspace`, `setWorkspaceShared`, `archiveWorkspace`,
`findArchiveBlockers`, `countWorkspaceContents`, `ensureSeedWorkspace`,
`listQuestionOwnership`, `moveFormToWorkspace` and `moveQuestionToWorkspace`.

**There is no `deleteWorkspace` and there never is one.** A workspace is archived, never
deleted (ADR-41), `archiveWorkspace` stamps one column and reaches no form, question or
response row, and the import-surface test asserts the absence the way it already asserts
that nothing re-pins a session's form version - so ADR-17's two whole-session delete paths
stay at two. A workspace that owns a form cannot be deleted even by a statement of
somebody's own: the reference from `forms` refuses it.

`startTestDb` seeds one workspace after migrating, because the two `NOT NULL` columns make
a workspace a precondition of every control-plane fixture in a consumer's test suite;
`SEED_WORKSPACE_ID` is the id to pass to `createForm` and `createQuestion`, and
`startTestDb({ seedWorkspace: false })` opts out for a suite that needs an installation with
no workspace at all.
