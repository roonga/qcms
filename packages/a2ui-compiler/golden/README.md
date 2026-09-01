# A2UI golden corpus

The reviewed, compiled A2UI output for the `@qcms/core` reference forms (task
012, ADR-18). Each document is a genuine `compileForm` result - never
hand-forged - captured once, hand-reviewed, and then frozen. The corpus is
three contracts at once:

1. **The compiler's regression net.** `src/golden-corpus.test.ts` recompiles
   every corpus form (through the real `compileDraft` publish path) and asserts
   the output equals the committed golden. A shape change fails here, naming the
   exact document and JSON path.
2. **The renderer's conformance input (task 028).** The portal serves the
   _stored_ compiled A2UI, never a recompilation (ADR-18). These documents are
   the fixtures the renderer conformance suite drives.
3. **The audit contract with `a2-react-aria`.** This corpus is the
   **renderer-compat contract** for `a2-react-aria`: every node type and prop
   that appears here is a shape the vendored renderer must accept and render.
   Auditing the renderer against a new upstream version means diffing it against
   this corpus.

## Append-only - the policy (ADR-18)

**A committed golden document is never edited or deleted.** The stored compiled
A2UI is immutable (R1) and served forever, so its golden must stay a faithful
record of what that compiler version produced. Consequences:

- If a compiler change alters any corpus form's output, the golden test fails.
  That is the signal working as intended - **do not "fix" the golden to match
  new output.** Either the change is a bug (revert it) or it is a deliberate,
  breaking A2UI change, which is handled by a spec bump (below).
- Adding a _new_ golden (a new corpus form, or a new spec version's directory)
  is always allowed and is how the corpus grows.
- The `scripts/check-golden-append-only.mjs` CI guard enforces this
  mechanically: it fails the build if any file under a `golden/` directory is
  **modified or deleted** in the diff against the default branch. Additions
  pass.

## Seeding a new golden

New goldens are generated from live compiler output, then hand-reviewed before
committing (they seed the renderer conformance suite, so a wrong golden is a
wrong contract):

```
UPDATE_GOLDEN=1 pnpm exec vitest run --project @qcms/a2ui-compiler golden-corpus
```

Review the diff by eye, confirm it is what the mapping (`docs/a2ui-mapping.md`)
prescribes, then commit. Never seed and commit blind.

## Spec-bump procedure (a breaking A2UI change)

Committed spec versions live in `v1/`, `v2/`, … (the latest is the current
target). When a genuinely breaking A2UI change arrives (a node/prop rename or
removal in a new `@a2ra/core`, a mapping change that alters existing documents):

1. Create a **new** directory (the next `vN/`) alongside the existing ones. Do
   not touch any existing `vN/`.
2. Seed the corpus forms' goldens into it from the new compiler output and
   hand-review them (the diff against the previous generation is the review: it
   must show the intended mapping change and the `compilerVersion` stamp, and
   nothing else).
3. Point the corpus runner at the new generation for the current compiler while
   keeping every earlier one rendered and asserted, for as long as documents
   compiled under it remain in any store - a stored snapshot resolves against its
   original generation forever (ADR-18, the stored copy is served forever).
4. Add the generation to the three places that enumerate them:
   `src/golden-corpus.test.ts` (`GOLDEN_DIR` and `RETAINED_GENERATIONS`),
   `packages/ui/src/test-support/golden.ts` (`VERSIONS`, the renderer's conformance
   input), and the log in `docs/a2ui-mapping.md`. `apps/api/e2e/support/fixtures.ts`
   derives the current one from the compiler stamp and needs no edit.

Every `vN/` directory remains in the tree and rendered forever; a generation bump is
purely additive. The machinery to _select_ a version per stored snapshot is
built when a real per-snapshot dispatch need arrives. Current generations on disk:

| Generation | Compiler | What it added                                                                                                          |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `v1/`      | `0.0.0`  | The task-011 launch mapping.                                                                                          |
| `v2/`      | `0.1.0`  | Task 026's `Honeypot` decoy, last in every step.                                                                      |
| `v3/`      | `0.2.0`  | Issue #186: `size` and `weight` on every heading, so a form title and a step title stop rendering at the body default. |

New goldens are always a **fresh file add** - never a rename/move into a `vN/`
directory (the append-only guard reads a rename as a deletion of the old path and
fails). This README is deliberately outside the guard, because it is the file the
guard's own procedure tells you to update.

## Layout

```
golden/
  README.md   this file
  v1/         one <form>.a2ui.json per corpus form, at generation v1
  v2/         the same forms as compiler 0.1.0 emitted them
  v3/         the current generation
```

Each corpus form has one `<form>.a2ui.json` per generation it existed for (the last
two joined in task 048, so they have no `v1/` document):

| Golden                         | Fixture                                        | What it pins                                                                                                          |
| ------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `kitchen-sink.a2ui.json`       | `forms/valid/kitchen-sink.json`                | Every question type across 3 steps; h1 on step 1, h2 on each; required/help/constraint props.                         |
| `insurance.a2ui.json`          | `forms/valid/insurance.json`                   | The DOMAIN_SCHEMA §6 flow: boolean + number in one step.                                                              |
| `minimal.a2ui.json`            | `forms/valid/minimal.json`                     | Smallest form: one step, one control.                                                                                 |
| `constraints-heavy.a2ui.json`  | `forms/valid/constraints-heavy.json`           | Every constraint-bearing control in a single dense step.                                                              |
| `deep-nesting-rules.a2ui.json` | `forms/valid/deep-nesting-rules.json`          | A depth-8 rule form; proves the compiled A2UI is a plain projection (rules apply at serve time, not in the document). |
| `author-messages.a2ui.json`    | `../fixtures/corpus/forms/author-messages.json` | Author-supplied validation messages (ADR-32). Appended in task 048, so `v2/` onwards.                                 |
| `boolean-labels.a2ui.json`     | `../fixtures/corpus/forms/boolean-labels.json`  | Boolean label overrides (ADR-36). Appended in task 048, so `v2/` onwards.                                             |

## Adding a golden

Introduce a new golden as a **fresh file add**, never by moving/renaming an existing
tracked file into `golden/` - the append-only guard detects renames (`R`) as a
deletion of the old path and fails the build. Create the file in place.
