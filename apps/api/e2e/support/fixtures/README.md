# API e2e fixture forms

Form and question definitions, plus their compiled A2UI documents, for the API's
own end-to-end scenario suite and for the portal e2e and `pnpm dev:portal` seeds.
Loaded through `apps/api/e2e/support/fixtures.ts`, never by path from a spec.

Everything here is **vehicle domain** (043's neutral-domain rule). Example forms
are rendered to real respondents, and `scripts/check-fixture-domain.mjs` fails the
build on a health or otherwise sensitive term appearing in any `.json` in this
directory.

## The two kitchen-sink forms, and why the names differ (issue #129)

There are two reference forms in this repository that exercise every question
type. They are different forms with **different question ids**, and until issue
#129 they shared a file name.

| File                                                                                                                         | Domain  | Questions unique to it                              | Loaded by                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `vehicle-kitchen-sink-form.json` (compiled: `vehicle-kitchen-sink.a2ui.json`)                                                | vehicle | `q_optional_cover`, `q_extra_detail`, `q_annual_km` | the API e2e scenario suite, the portal Playwright suite, and `pnpm dev:portal`                                                      |
| `packages/core/fixtures/forms/valid/kitchen-sink.json` (compiled: `packages/a2ui-compiler/golden/v*/kitchen-sink.a2ui.json`) | health  | `q_preexisting_conditions`, `q_medical_history`     | the `@roonga/qcms-core` and `@roonga/qcms-a2ui-compiler` suites, and the `@roonga/qcms-ui` renderer conformance and keyboard suites |

The failure this naming prevents is quiet rather than loud. A selector written
from one form's question ids and run against the other does not error: the ids
simply do not exist there, the query finds nothing, and it reads as a broken
assertion rather than a wrong fixture. That cost a full test-authoring cycle
during issue #98.

Only this side could move. The golden corpus is append-only (ADR-18) and
`pnpm check:golden-append-only` fails on any modification or deletion under a
`golden/` directory, so renaming the health-domain document was never available.

**The seeded form's slug is still `kitchen-sink`.** That slug is the dev and
manual-test URL (`/f/kitchen-sink`, quoted in `docs/DEVELOPER_GUIDE.md` and
`docs/a11y-manual-pass-checklist.md`) rather than a fixture-file identifier, and no
health-domain FORM is ever seeded under it, so the two never collide there. The
hazard issue #129 records is between the two compiled **documents**, and that is
what the file names now separate.

## A third form, deliberately not in this directory

`sample-library` (`apps/api/scripts/fixtures/sample-library-form.json`) is the one
form `pnpm dev:seed` publishes into the composed stack. It pins exactly the seven
questions that seed writes - the whole of `packages/core/fixtures/questions/valid`,
including the two health-domain ones - so it could never live here:
`scripts/check-fixture-domain.mjs` fails the build on those terms in any `.json` in
this directory, which is the 043 rule working as intended. It lives beside the seed
script that reads it and the Dockerfile that ships it, and it is registered in
`COMPILED_FIXTURES` here like the other two, so the same drift guard covers it.

Its form id and slug are its own (`frm_sample_library`, `sample-library`), for the
reason this document's first section exists: reusing `frm_kitchen_sink` would put a
third form under a name two others already answer to.

## Regenerating a compiled document

The compiled documents here are `regenerable: true` in `COMPILED_FIXTURES`
(`apps/api/e2e/support/fixtures.ts`): unlike the golden corpus, they are
compiler output that this repository owns and rewrites when the mapping changes.
`apps/api/e2e/support/fixture-drift.test.ts` recompiles each one and fails on a
divergence; follow the instructions it prints.
