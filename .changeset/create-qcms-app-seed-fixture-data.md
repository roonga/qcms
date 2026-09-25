---
"create-qcms-app": patch
---

Keep the sample-data fixtures out of the scaffolded tree (issue #994).

`apps/api/scripts/fixtures/` is the form `pnpm dev:seed` publishes into the QCMS
repository's composed stack, plus the compiled A2UI document it stores verbatim. It is
input to `apps/api/scripts/seed-fixtures.ts`, which the generator already drops as
repository tooling, so scaffolding the data without the script that reads it would put
two files in an adopter's tree that nothing in that tree opens.

The exclusion is a directory prefix rather than two path entries, so a third fixture
added beside them belongs to the same dropped script instead of appearing in every
scaffolded project by default.

No generated template file changes and nothing adopter-visible: the rule prevents an
addition rather than removing anything a previous sync produced.
