# @qcms/ui

The A2UI renderer for qcms - the **single** renderer that both the portal (serving
respondents) and the admin (previewing forms) go through, so what an author
previews is exactly what a respondent gets (ARCHITECTURE §6, ADR-18).

## `A2UIStepRenderer`

A controlled component that renders one compiled A2UI **step document**:

```tsx
import { A2UIStepRenderer } from "@qcms/ui";
import "@qcms/ui/theme.css"; // or set the --color-* tokens in your own globals

<A2UIStepRenderer
  document={step} // one entry of a compiled form's `documents` array: { stepId, root }
  values={values} // parent-owned canonical answers, keyed by questionId
  errors={errors} // parent-owned server-validation errors, keyed by questionId
  onChange={(name, value) => {
    /* value is the canonical AnswerValue (task 002) for that question type */
  }}
  onBlur={(name) => {
    /* touched semantics; focus policy is 029/030 */
  }}
  locale="en-US"
  specVersion={compiled.a2uiSpecVersion}
/>;
```

- **Controlled.** The parent owns `values` and `errors`; the renderer owns no
  fetch and no state beyond the vendored controls' ephemeral input. Values flow
  down; `onChange` fires the canonical `AnswerValue` encoding for each question
  type (NFC string, finite number, `YYYY-MM-DD`, boolean, OptionId, OptionId[]).
- **Advisory hints vs. authority.** Constraint props compiled into the document
  are advisory client-side UX; the authoritative errors are the server ones the
  parent passes, surfaced in each control's error slot.
- **`specVersion`** selects the render generation - the ADR-18 seam. Today the
  corpus is one generation, so every version resolves to the same registry.

## Vendored components (ADR-22)

This package imports **only** the a2-react-aria stack: `@a2ra/core`,
`react-aria-components` (+ `@internationalized/date`, `zod`), React, and its own
vendored sources. No other component library - enforced by the import-surface
test and an eslint rule.

The a2ra components are **vendored source**, not imported from `@a2ra/core`:

- `a2ra.json` pins the registry (an immutable commit of `roonga/a2-react-aria`).
- Sources live under `src/components/a2ui/` and are kept **byte-for-byte
  upstream** (excluded from qcms lint/prettier) so `npx @a2ra/cli diff` stays
  clean. qcms wiring - the controlled adapters that inject `value`/`onChange`/
  `errorMessage` by field `name` - lives in `src/registry.tsx`, not in the
  vendored files.
- Upgrades are deliberate events: pull with `@a2ra/cli diff`, then the
  conformance suite must stay green.

> **Registry pin note.** `@a2ra/core@1.0.0-preview.7` ships `TextArea`, but
> `@a2ra/cli@1.0.0-preview.4`'s _default_ registry commit predates it. `a2ra.json`
> therefore pins a newer immutable registry commit that includes `text-area`,
> consistent with the pinned core. (Reported upstream: the CLI's default registry
> pin lags the published core package.)

## Theming

The vendored `*.styles.ts` files are Tailwind utilities over shadcn-convention
`var(--color-*)` custom properties. This package ships no palette of its own
(ADR-22, "expose, don't opine"); `@qcms/ui/theme.css` exposes the upstream
reference tokens (light + `.dark`) as an opt-in. Shells wire Tailwind in their
build and either import that file or define the same token names in their
globals.

## Tests (the conformance contract)

Component layer per ADR-23 (Vitest + testing-library + axe in jsdom). The suite
is the renderer's contract with the compiler and with a2-react-aria (risk #3):
it runs over the **entire append-only golden corpus** (`packages/a2ui-compiler/
golden/` v1 + v2). Per golden document: renders without error, an
accessibility-tree snapshot (role/name queries), zero axe violations, and a
controlled value round-trip asserted with task 002's own `AnswerValue` parsers.
Plus a kitchen-sink keyboard walkthrough (Tab order, radio arrow keys, checkbox
Space) and the import-surface guard.

```sh
pnpm --filter @qcms/ui test
```
