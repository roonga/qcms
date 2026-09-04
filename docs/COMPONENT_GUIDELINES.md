# Component guidelines: adding or changing an input control

Use this checklist when the `@qcms/ui` registry gains a control or an existing question type changes how it renders.

## First: is this ADR-sized or checklist-sized?

- **A new question type** (the kernel's closed set grows) is **ADR-sized**: kernel schema + rules DSL reach + compiler mapping + an APPENDED golden corpus entry + this checklist at the end. Do not start from the component.
- **A new rendering for an existing type** (like the `singleChoice >7` Select split) or a vendored-component addition is **checklist-sized**: everything below, no ADR.

## The checklist

1. **Vendoring (ADR-22).** Components come from the a2-react-aria registry via the a2ra CLI, pinned to an immutable, core-consistent registry commit in `a2ra.json` (the CLI's default pin can trail published core - 028). Vendored files under `src/components/a2ui/**` stay byte-identical to upstream; QCMS behavior lives in the adapter, never in edits to vendored source. **Fidelity is a gate, not a promise** (issue #189): `pnpm check:a2ra-fidelity` hashes every file in the vendored tree and compares it against `packages/ui/a2ra-manifest.json`, which records upstream's own content at the pinned commit, so a drift introduced by any earlier task is red on every run, offline. A pin move refreshes the manifest (`node scripts/check-a2ra-fidelity.mjs --refresh`, the one mode that needs the network) and the `a2ra diff` transcript in `packages/ui/a2ra-diff.md` in the same change: the gate says the bytes match, the transcript says what a human checked and why. The four sibling directories - `submit/`, `schema/`, `form-state/`, `action-context/` - are QCMS-owned and scanned by the ordinary gates; only `a2ui/` is upstream's (issue #775).
2. **Registry entry.** Explicit `createRegistry` set only - never `defaultRegistry`. The adapter is a controlled component translating the control's raw value to and from canonical `AnswerValue` through the field context.
3. **ADR-31 commit moment - a decision, not a default.** Add the control's row to the classification (`apps/portal/lib/visible.ts`) choosing `change` / `completion` / `blur` / `groupExit` per ADR-31's reasoning, and satisfy the exhaustiveness tripwire (#91): the runtime `blur` default exists for resilience, not for skipping the decision. If no ADR-31 row fits, that is an ADR-31 amendment, not an improvised moment.
4. **Clear path - absence, never an "answer of nothing" (issue #98, ADR-33).** Name the control's clear gesture and make it emit `undefined`, so the host posts one ADR-33 retraction at the commit moment above. Three traps, each of which shipped once: (a) posting the empty value (`""` for text, `[]` for multiChoice) instead of a retraction - the API refuses both since issue #128's batch (`EMPTY_ANSWER_NOT_ALLOWED`, so the respondent's clear becomes an error rather than a clear), and before that refusal existed the empty value was stored and _satisfied_ `required` while holding nothing; the respondent cannot mean it either, because an empty box or an all-unchecked group IS the pristine rendering, and "none of these" is sayable only as an authored option; (b) if a constraint rejects the empty value (`minLength`, `minSelected`) the empty post 422s and the server silently keeps the **previous** answer, which is issue #95's defect class; (c) a react-aria control may not report the clear at all (the DatePicker's complete-to-incomplete gap), in which case read what the control DISPLAYS at the commit moment - still adapter-side, never a vendored edit. Feed the parent's empty state back as the control's own empty rendering (`""`, `[]`, and `null` for the discrete controls - see 11) rather than `undefined`, or react-aria takes its controlled-to-uncontrolled path and redisplays the value just cleared. If the control has **no** clear gesture (a chosen radio or Select option cannot be deselected), assert that rather than assume it.
5. **Conformance tests.** Extend the corpus-driven suite: assertions target the ACCESSIBILITY TREE (role + computed accessible name), never DOM snapshots. New corpus content is appended, never edited.
6. **Keyboard walkthrough.** The control joins `keyboard.test.tsx`'s Tab-order and interaction coverage (30s load-tolerant budget per #61 - do not add per-test timeouts elsewhere).
7. **No-JS path.** Wire the native-submit serialization or record the explicit exception (the RAC NumberField precedent, #18) - silence is not an exception.
8. **A11y exclusions and focus.** Hidden native mirrors sit inside `aria-hidden`; the honeypot pattern is preserved; the focus-target rules (`canTakeFocus`, value-control preference, `[role=spinbutton]` first) must land on a rendered control - extend the focus-target Playwright spec for the new control's landing point.
9. **Theming (ADR-30, contract in `docs/theming.md`).** Styles consume the four token groups (color/type/spacing/radius) only; the HC mode's border treatment must hold. A **vendored** control is never edited to theme it (ADR-22 byte-fidelity): its spacing, radius and type-scale wiring goes in `packages/ui/src/theme-components.css`, anchored on `[data-qcms-field]` / `[data-rac]` **beneath the scope carrier `[data-qcms-theme-scope]`** (ADR-38: every rule in that sheet is a descendant of the carrier, which is what contains it), and a new control's box needs a rule there plus a computed-style assertion in `apps/portal/e2e/theming.pw.ts`. A control that shows **digits** joins the tabular-figures selector in the same file, which reads `--type-numeric` rather than hardcoding `"tnum"`. A control must render correctly in **every** font the registry ships (`packages/ui/src/font-registry.ts`), so it never assumes a family's metrics: `apps/portal/e2e/fonts.pw.ts` sweeps all of them and re-measures the WCAG 1.4.12 floors under each.
10. **Lint coverage.** New files and directories must be inside a lint glob (the third-recurrence lesson, #64). This is now enforced rather than remembered: **`pnpm check:lint-coverage`** (part of `check:all`, so `verify` and CI both run it) fails when a tracked source file sits outside every `lint` script's scope, which is the check #64 asked for. Verifying with a deliberate violation is still worth doing, because the gate proves the file is _reached_, not that any rule fires on it. Adding a directory to `packages/ui` that sits outside `src/` is a **three-place** change, not one: the `eslint` glob, the lint/typecheck `tsconfig.json` (its `rootDir` was `src`, so a sibling directory raises TS6059 until the build-only settings move to `tsconfig.build.json`), and typescript-eslint's `projectService`, which needs the file to belong to _some_ project or every rule on it fails to resolve. 052 hit all three in turn adding `tools/`.
11. **Controlled, always, and one instance per question (issue #144).** react-stately decides controlled-vs-uncontrolled by `value !== undefined` alone, so an adapter that passes `undefined` for "nothing yet" hands react-aria its uncontrolled path, where the control serves its own last internal value in place of the parent's. Every adapter therefore passes a defined empty value on every render: `""` for text, `[]` for a checkbox group, `NaN` for a number, and **`null`** for the discrete controls (RadioGroup, Select) - never `""` there, which would leave a radio group unreachable (no radio matches, so `useRadio` gives every one `tabIndex=-1`) and is not a valid option key. Separately, key the control by its questionId: `A2Renderer` keys children by array INDEX, so a step swap or a branch prune re-targets a mounted control at a different question, and the control's internal state (react-aria's `lastFocusedValue`, the DatePicker's last complete date) travels with it into a question it does not belong to. Prove both in jsdom (`controlled-flip.test.tsx`): a `console.warn` spy asserting no `A component changed from ...` line, and the control's displayed state plus tab order after a document swap.

    **The scope is every controlled form built on the vendored controls, not only the renderer adapters (issue #225).** The trap bit a second time on a surface this item did not cover: the 032 admin question editor, an ordinary React form with no A2UI renderer anywhere in it, whose state was silently emptied when React 19's automatic post-action form reset reached react-aria's `useFormReset` (issue #220 carries the diagnosis and the `onResetCapture` opt-out). So read the rule as binding on the admin's own composition sites as much as on the `packages/ui` adapters. Two details made that instance hard to see, and both are worth knowing before you go looking:

    - **The React warning only fires for controls whose empty state is `undefined`.** The date pickers flipped controlled state and warned about it. A `NumberField`'s empty state is `NaN`, which is a defined value, so the identical wipe happened **silently** on the number panel and was caught only by an explicit assertion. A clean `console.warn` spy is therefore not evidence that nothing flipped: assert the displayed value too.
    - **The opt-out must be registered in the capture phase.** react-aria subscribes to `reset` on the form element itself while React delegates its own handlers to the root, so a bubble-phase `onReset` sets `defaultPrevented` too late for react-aria to see it. `onResetCapture` works; `onReset` does not.

12. **Layer discipline (ADR-23).** jsdom carries no layout: anything layout- or visibility-dependent is proven in Playwright, not unit tests; the shared jsdom setup carries the react-aria polyfills (matchMedia, ResizeObserver, CSS.escape, scrollIntoView).

## Decide where the behaviour is testable before you write the component

This is a design instruction, not a limitation to work around, and it binds every client component in the repository as well as the `@qcms/ui` adapters above.
There are two layers below Playwright, they answer different questions, and which one a component ends up in is decided by how it is written rather than by how it is tested afterwards.
Pick one on purpose, at design time, because by the time the component holds the logic the choice has become a refactor.

**Lift the decision into a pure module, for anything that is a decision.**
A branch table, a selection rule, an outcome the operator reads: write it as a function over its inputs in `lib/`, with the edges injected as parameters, and the component keeps the markup and the `useState` call.
Every branch is then a fast unit test that states the rule in the rule's own words, and the browser walk only has to prove the two are wired together (ADR-23: e2e at the highest layer that exists for it).
Four exemplars, and copying any of them gets the shape right by default:

- `apps/admin/lib/recovery-copy.ts` - `copyRecoveryCodes(clipboard, codes)` over an **injected** clipboard, so absent, refused and synchronously-throwing are three ordinary tests
- `apps/admin/lib/forms/picker-selection.ts` - the multi-select rules of the add-question dialog
- `apps/admin/lib/forms/pin-grid.ts` - the pin grid's rows and row menu
- `apps/admin/lib/questions/option-grid.ts` - the option editor's pending-row state machine

**Render it, for behaviour that only exists rendered.**
`apps/admin` has a jsdom project (`apps/admin/vitest.dom.config.ts`, issue #352) and so does `@qcms/ui` (`packages/ui/vitest.config.ts`): `.test.tsx` files run there with testing-library, real events and real effects.
This is the layer for what a user sees after pressing something - a dialog that stays open and says why, a live region that fills, an error state that replaces a spinner - and it is the only layer below Playwright that can observe a rejected promise reaching a `.catch`.
The `*-rejects.test.tsx` files under `apps/admin/components/` are the worked examples.

`apps/portal` has **no** jsdom project of its own and no `.test.tsx` files today, so the render layer is not available to it.
That is stated rather than implied: the respondent-facing rendering lives in `@qcms/ui`, which has the layer, and whether the portal's own client components need one has not been established either way.

**Prefer the lift where both would work.**
A rule expressed as a function can be read and named, and it is where the reasoning goes; a render test asserts what a rule looks like from outside.
The render layer is for the wiring and the visible outcome, not a substitute for having a rule anywhere.

**A `"use server"` module cannot export helpers for you to test** (issue #256).
Next requires every export of such a module to be an async server action, so a guard like `withinCap` inside `apps/admin/app/(shell)/forms/actions.ts` cannot be exported and asserted on directly.
That is structural and is not going to change, so it is the same instruction one step earlier: the guard belongs in an ordinary module under `lib/`, imported by the action.
The action file keeps the wiring; the decision keeps its test.

**jsdom carries no layout.**
Anything layout-, visibility- or measurement-dependent is proven in Playwright regardless of which layer above it is written at (ADR-23, checklist item 12).

## Evidence expectations

The PR body proves each step it claims: pack/diff transcripts for vendoring, exact-count post assertions for the commit moment, tree-level conformance output, and browser assertions for affected respondent-visible states and viewports. A clear-path claim also asserts the post's **body** (`null` versus `""` versus `[]`), because a count alone cannot distinguish the encodings.
