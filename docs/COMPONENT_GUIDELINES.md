# Component guidelines: adding or changing an input control

The checklist a session walks when the `@qcms/ui` registry gains a control or an existing question type changes how it renders. Codifies the 028 retro patterns, ADR-31, and the lint/tripwire lessons (#60, #64, #91) so they stop being rediscovered per session.

## First: is this ADR-sized or checklist-sized?

- **A new question type** (the kernel's closed set grows) is **ADR-sized**: kernel schema + rules DSL reach + compiler mapping + an APPENDED golden corpus entry + this checklist at the end. Do not start from the component.
- **A new rendering for an existing type** (like the `singleChoice >7` Select split) or a vendored-component addition is **checklist-sized**: everything below, no ADR.

## The checklist

1. **Vendoring (ADR-22).** Components come from the a2-react-aria registry via the a2ra CLI, pinned to an immutable, core-consistent registry commit in `a2ra.json` (the CLI's default pin can trail published core - 028). Vendored files under `src/components/a2ui/**` stay byte-identical to upstream; QCMS behavior lives in the adapter, never in edits to vendored source. Fidelity is provable only by `a2ra diff` - commit its transcript with the change.
2. **Registry entry.** Explicit `createRegistry` set only - never `defaultRegistry`. The adapter is a controlled component translating the control's raw value to and from canonical `AnswerValue` through the field context.
3. **ADR-31 commit moment - a decision, not a default.** Add the control's row to the classification (`apps/portal/lib/visible.ts`) choosing `change` / `completion` / `blur` / `groupExit` per ADR-31's reasoning, and satisfy the exhaustiveness tripwire (#91): the runtime `blur` default exists for resilience, not for skipping the decision. If no ADR-31 row fits, that is an ADR-31 amendment, not an improvised moment.
4. **Conformance tests.** Extend the corpus-driven suite: assertions target the ACCESSIBILITY TREE (role + computed accessible name), never DOM snapshots. New corpus content is appended, never edited.
5. **Keyboard walkthrough.** The control joins `keyboard.test.tsx`'s Tab-order and interaction coverage (30s load-tolerant budget per #61 - do not add per-test timeouts elsewhere).
6. **No-JS path.** Wire the native-submit serialization or record the explicit exception (the RAC NumberField precedent, #18) - silence is not an exception.
7. **A11y exclusions and focus.** Hidden native mirrors sit inside `aria-hidden`; the honeypot pattern is preserved; the focus-target rules (`canTakeFocus`, value-control preference, `[role=spinbutton]` first) must land on a rendered control - extend the focus-target Playwright spec for the new control's landing point.
8. **Theming (ADR-30).** Styles consume the four token groups (color/type/spacing/radius) only; numeric displays use tabular figures; the HC mode's border treatment must hold.
9. **Lint coverage.** New files and directories must be inside a lint glob (the third-recurrence lesson, #64) - verify with a deliberate violation, then remove it.
10. **Layer discipline (ADR-23).** jsdom carries no layout: anything layout- or visibility-dependent is proven in Playwright, not unit tests; the shared jsdom setup carries the react-aria polyfills (matchMedia, ResizeObserver, CSS.escape, scrollIntoView).

## Evidence expectations

The PR body proves each step it claims: pack/diff transcripts for vendoring, exact-count post assertions for the commit moment (the #90 pattern), tree-level conformance output, and gate screenshots when the rendering is respondent-visible.
