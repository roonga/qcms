# 028 - A2UI renderer (`packages/ui`)

**Stage:** 7 · **Package:** `@qcms/ui` · **Depends on:** 012 (golden corpus) · uses `roonga/a2-react-aria`
**References:** `ARCHITECTURE.md` §6, §11 · **ADR-18** · risk register #3 · `docs/a2ui-mapping.md` (011's inventory - the authoritative component/prop list)
**External input required:** `@a2ra/core` installed **exact-pinned**; a2ra components **vendored** into this package via `npx @a2ra/cli add` (`a2ra.json` committed; sources under `src/components/a2ui/`). The upstream docs - styling guide and component pages - are required reading (ADR-22). Upgrades are deliberate events: reviewed `a2ra diff` pull + conformance suite green. Gaps between golden documents and what the vendored set renders are cross-repo issues in both repos - never a local workaround that forks the design language, never a second renderer.

## Context

The shared renderer both portal and admin preview use - preview fidelity depends on this being the *only* renderer. Its contract is the golden corpus: every golden document, every spec version, renders correctly. Accessibility structure is built here; flow-level behaviors (focus, announcements) get their hooks here and their policy in 029/030.

## Deliverables

- `<A2UIStepRenderer document={} values={} errors={} onChange={} onBlur={} locale specVersion />` - controlled component built on `@a2ra/core`'s `A2Renderer` with a `createRegistry` over the vendored components (never `defaultRegistry` - lean bundle, explicit surface): renders one compiled step document; owns no fetch, no state beyond ephemeral input state; parent owns values/errors (BFF/portal wire the server round-trips).
- Vendored component coverage for every A2UI component the compiler emits (011's mapping table is the checklist - registry names): `a2ra add` each needed component and register it; missing upstream components are the 011 cross-repo issues landing here.
- Client-side hint enforcement (advisory UX only): constraint hints from documents surface as inline hints/soft blocks; server errors (the authority) render in each question's error slot with `aria-describedby` wiring.
- Accessibility structure: label/description/error associations per control; heading structure from document; the honeypot field rendered per 026's contract (invisible to AT); every control keyboard-operable (mostly inherited from `a2-react-aria` - conformance-verify, don't assume).
- **Conformance suite:** for every golden document (all spec versions present in the corpus): renders without error; snapshot of the accessibility tree (testing-library queries by role/name, not DOM snapshots); axe pass per document; controlled round-trip (type into each control → `onChange` fires canonical `AnswerValue` shapes from 002).
- Theming per upstream's shadcn-convention tokens (ADR-22): vendored components reference `var(--color-*)` custom properties; shells set the tokens in their globals. Expose, don't opine - no hardcoded palette values beyond what upstream ships. Tailwind wired here (the vendored `*.styles.ts` files are Tailwind utilities) and in both apps' builds - it arrives with this stack, not as a separate decision.
- Import-surface rule (ADR-22): this package imports only `@a2ra/core`, `react-aria-components`, and its own vendored sources - no other component library; lint-enforced here, inherited by both apps.
- `specVersion` dispatch: v1 today; the seam where future spec versions branch (ADR-18).

## Exit criteria

1. Conformance suite green over the full corpus; wired into CI of **both** this repo and documented as the suite `a2-react-aria` runs against (risk #3 contract).
2. axe: zero violations per golden document.
3. Value round-trip: every question type emits canonical encodings (reuse 002's schemas as assertions).
4. Kitchen-sink document keyboard walkthrough test (tab order, radio arrow keys, checkbox space).
5. Import-surface test green (ADR-22: no component library beyond the a2ra stack).

## Out of scope

Data fetching, routing, focus-on-branch-change policy (029/030 - hooks exist here), admin editor UI.
