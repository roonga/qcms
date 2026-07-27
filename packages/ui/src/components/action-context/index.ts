/**
 * The `ActionContext` module the vendored `button` component imports as
 * `../../action-context` (task 031).
 *
 * This file is QCMS-owned glue, not vendored source, and it exists because of a
 * gap in the upstream registry rather than by design. Upstream's `Button.tsx`
 * lives inside `@a2ra/core` (`packages/core/src/components/button/Button.tsx`), so
 * it reaches its sibling module by a relative path. The registry entry
 * (`registry/button.json`) ships that source verbatim, relative path included, but
 * declares no file and no `registryDependencies` entry for `action-context`. So
 * `a2ra add button` produces a component that cannot resolve its own import in any
 * consumer, and ADR-22 forbids the alternative (editing vendored source, which
 * would fork the design language and dirty `a2ra diff`).
 *
 * The fix that keeps the vendored copy byte-identical is to provide the module at
 * the path the vendored source expects, which is the same shape task 028 used for
 * `../../form-state` and `../../schema`. This one **re-exports from `@a2ra/core`**
 * rather than copying the source, deliberately: a React context is identified by
 * object identity, so a local copy would give `A2Renderer` (from `@a2ra/core`) and
 * the vendored `Button` two different contexts, and the Button's action mode would
 * silently do nothing. Re-exporting keeps exactly one `ActionContext` in the
 * process.
 *
 * The admin kit uses `Button` as an ordinary React component with `onPress`, well
 * outside any `A2Renderer`, so `useContext(ActionContext)` is `null` there and the
 * `onPress` branch runs - which is the intended fallback, not a workaround.
 *
 * CROSS-REPO: the upstream registry entry should carry `action-context` as a file
 * or a registry dependency (or import it from the package root), so `a2ra add
 * button` compiles standalone. Until it does, this module is what makes the
 * vendored copy usable, and it must be deleted when upstream ships the fix.
 */

export type { ActionCtx } from "@a2ra/core";
export { ActionContext } from "@a2ra/core";
