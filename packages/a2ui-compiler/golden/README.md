# A2UI golden corpus

The reviewed, compiled A2UI output for the `@qcms/core` reference forms (task
012, ADR-18). Each document is a genuine `compileForm` result — never
hand-forged — captured once, hand-reviewed, and then frozen. The corpus is
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

## Append-only — the policy (ADR-18)

**A committed golden document is never edited or deleted.** The stored compiled
A2UI is immutable (R1) and served forever, so its golden must stay a faithful
record of what that compiler version produced. Consequences:

- If a compiler change alters any corpus form's output, the golden test fails.
  That is the signal working as intended — **do not "fix" the golden to match
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

The current spec version lives in `v1/`. When a genuinely breaking A2UI change
arrives (a node/prop rename or removal in a new `@a2ra/core`, a mapping change
that alters existing documents):

1. Create a **new** directory `v2/` alongside `v1/`. Do not touch `v1/`.
2. Seed the corpus forms' `v2/` goldens from the new compiler output and
   hand-review them.
3. Point the corpus runner at the new version for the current compiler while
   keeping `v1/` rendered and asserted for as long as `v1` documents remain in
   any store — old stored snapshots still resolve against their original spec
   version (ADR-18, the stored copy is served forever).

`v1/` documents remain in the tree and remain rendered forever; a spec bump is
purely additive. The machinery to _select_ a version per stored snapshot is
built when the first breaking change actually arrives (task 012 out of scope) —
until then there is exactly one version, `v1`.

## Layout

```
golden/
  README.md   this file
  v1/         one <form>.a2ui.json per corpus form, at A2UI spec v1
```

| Golden | Core fixture | What it pins |
|---|---|---|
| `v1/kitchen-sink.a2ui.json` | `forms/valid/kitchen-sink.json` | Every question type across 3 steps; h1 on step 1, h2 on each; required/help/constraint props. |
| `v1/insurance.a2ui.json` | `forms/valid/insurance.json` | The DOMAIN_SCHEMA §6 flow: boolean + number in one step. |
| `v1/minimal.a2ui.json` | `forms/valid/minimal.json` | Smallest form: one step, one control. |
| `v1/constraints-heavy.a2ui.json` | `forms/valid/constraints-heavy.json` | Every constraint-bearing control in a single dense step. |
| `v1/deep-nesting-rules.a2ui.json` | `forms/valid/deep-nesting-rules.json` | A depth-8 rule form; proves the compiled A2UI is a plain projection (rules apply at serve time, not in the document). |

## Adding a golden

Introduce a new golden as a **fresh file add**, never by moving/renaming an existing
tracked file into `golden/` — the append-only guard detects renames (`R`) as a
deletion of the old path and fails the build. Create the file in place.
