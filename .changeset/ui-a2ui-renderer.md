---
"@qcms/ui": minor
---

A2UI renderer (task 028): `<A2UIStepRenderer>`, the single, controlled renderer
that portal serving and admin preview both go through (ARCHITECTURE §6). Built
on `@a2ra/core`'s `A2Renderer` over an explicit `createRegistry` of a2-react-aria
components vendored via `@a2ra/cli` (never `defaultRegistry`, ADR-22): the
vendored sources live under `src/components/a2ui/` and `a2ra.json` pins the
registry commit.

- Controlled: the parent owns `values`/`errors`; the renderer owns no fetch and
  no state beyond the vendored controls' ephemeral input. Each control fires the
  canonical `AnswerValue` (task 002) for its question type; server errors render
  in each control's error slot with react-aria's ARIA wiring.
- Coverage for every component the compiler emits (`docs/a2ui-mapping.md`):
  TextField, TextArea, NumberField, DatePicker, RadioGroup/Radio, Select,
  CheckboxGroup/Checkbox, structural Text/Form/Flex, plus the qcms `Honeypot`
  decoy (task 026), rendered visually-hidden and invisible to assistive tech.
- Conformance suite over the full append-only golden corpus (v1 + v2): renders,
  accessibility-tree snapshots, zero axe violations, controlled value round-trip,
  a kitchen-sink keyboard walkthrough, and an ADR-22 import-surface guard.
- `specVersion` is the ADR-18 dispatch seam (single generation today).
- New dependencies are the ADR-22/23 stack: `react-aria-components`,
  `@internationalized/date`, `zod`, React 19 (peer), and the Vitest component
  layer (`@testing-library/*`, `axe-core`, `jsdom`). Reference design tokens are
  exposed at `@qcms/ui/theme.css` (upstream tokens; shells set their own).
