import type { StepId } from "@roonga/qcms-core";

/**
 * A structural A2UI node. The compiler's runtime stays React-free and never
 * imports `@a2ra/core`, so it emits this plain-data shape instead; it is
 * structurally what the vendored schemas accept, and the test suite validates
 * every emitted document against them.
 *
 * `children` is an ordered list of child nodes or a text string, never both,
 * matching the upstream node shape.
 */
export interface A2UINode {
  readonly type: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly children?: readonly A2UINode[] | string;
}

/**
 * One compiled step, in form order (ARCHITECTURE §3). The renderer serves these
 * from the stored snapshot, never from a recompilation (ADR-18).
 */
export interface A2UIDocument {
  readonly stepId: StepId;
  readonly root: A2UINode;
}

/**
 * The compiler's output for a whole form, with the version stamps ADR-18
 * requires on stored compiled UI. The same snapshot and options always produce
 * a structurally identical value.
 */
export interface CompiledForm {
  readonly documents: readonly A2UIDocument[];
  readonly compilerVersion: string;
  readonly a2uiSpecVersion: string;
}
