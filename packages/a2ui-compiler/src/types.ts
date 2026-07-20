import type { StepId } from "@qcms/core";

/**
 * A structural A2UI node (task 011). The compiler's runtime stays React-free
 * and never imports `@a2ra/core`, so it emits this plain-data shape rather than
 * the renderer's node types; it is structurally the `A2NodeInput` the
 * `@a2ra/core` Zod schemas accept, and the test suite validates every emitted
 * document against those schemas (exit criterion 5).
 *
 * `children` is either an ordered list of child nodes (containers, groups) or a
 * text string (`Text` nodes) — never both, matching the upstream node shape.
 */
export interface A2UINode {
  readonly type: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly children?: readonly A2UINode[] | string;
}

/**
 * One compiled step: the A2UI document keyed by its `stepId`. One document per
 * step, in form order (ARCHITECTURE §3 — one document per step). The renderer
 * (028) serves these from the stored snapshot, never a recompilation (ADR-18).
 */
export interface A2UIDocument {
  readonly stepId: StepId;
  readonly root: A2UINode;
}

/**
 * The compiler's output for a whole form: one document per step plus the
 * version stamps ADR-18 requires on stored compiled UI. Deterministic and
 * side-effect free — the same snapshot and options always produce a
 * structurally identical value (exit criterion 2).
 */
export interface CompiledForm {
  readonly documents: readonly A2UIDocument[];
  /** The compiler that produced this output (`version.ts`). */
  readonly compilerVersion: string;
  /** The pinned `@a2ra/core` schema version the output targets (`version.ts`). */
  readonly a2uiSpecVersion: string;
}
