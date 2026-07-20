import type { FrozenSnapshot, LocaleCode, QuestionDefinition, QuestionRef, Step } from "@qcms/core";

import { honeypotNode } from "./honeypot.js";
import { questionToNode, type TextResolver } from "./mapping.js";
import type { A2UIDocument, A2UINode } from "./types.js";

/**
 * The step-resolver seam (task 011, ARCHITECTURE §12 — "Step-resolver /
 * compiler swap"). `compileForm` produces every step's document through a
 * {@link StepResolver}; the {@link staticStepResolver} is the launch
 * implementation (a deterministic projection of the pinned domain model). The
 * reserved Phase-4 extension is an agent/adaptive resolver implementing the
 * same interface to produce documents that respond to prior answers — see
 * `docs/agent-seam.md`. The seam is *authoring/compile-time*; the serving path
 * never sees an LLM (ADR-25) and serves the stored document (ADR-18).
 */

/**
 * Everything a resolver needs to compile one step, assembled by `compileForm`
 * from the frozen snapshot. The resolver does no I/O and no lookups of its own
 * (mirrors the kernel's R3 discipline — state is passed in).
 */
export interface StepResolverContext {
  /** The published snapshot being compiled (source of form title, default locale). */
  readonly snapshot: FrozenSnapshot;
  /** The active resolution locale (`options.locale ?? defaultLocale`). */
  readonly locale: LocaleCode;
  /** Resolve a {@link LocalizedText} to a display string for the active locale. */
  readonly resolveText: TextResolver;
  /** Resolve a step's pinned {@link QuestionRef} to its {@link QuestionDefinition}. */
  readonly resolveQuestion: (ref: QuestionRef) => QuestionDefinition;
  /** True for the form's first step — only then is the form-title `h1` emitted. */
  readonly isFirstStep: boolean;
}

/**
 * The interface an adaptive/agent resolver would implement. One call per step,
 * returning that step's A2UI document. Deterministic for the static
 * implementation; an adaptive one may branch on answers threaded through a
 * richer context in a later version of this seam.
 */
export interface StepResolver {
  readonly resolveStep: (step: Step, context: StepResolverContext) => A2UIDocument;
}

/** A `Text` heading node (`h1` form title, `h2` step title) — the page outline. */
function heading(as: "h1" | "h2", text: string): A2UINode {
  return { type: "Text", props: { as }, children: text };
}

/**
 * The launch resolver: a pure, deterministic projection. Each step compiles to
 * `Form → Flex(column)` carrying the heading structure (form title `h1` on the
 * first step, step title `h2` on every step), one control node per pinned
 * question, and — last — one visually-hidden honeypot decoy (abuse controls,
 * task 026; `docs/a2ui-mapping.md`).
 */
export const staticStepResolver: StepResolver = {
  resolveStep(step, context) {
    const children: A2UINode[] = [];
    if (context.isFirstStep) {
      children.push(heading("h1", context.resolveText(context.snapshot.definition.title)));
    }
    children.push(heading("h2", context.resolveText(step.title)));
    for (const item of step.items) {
      children.push(
        questionToNode(context.resolveQuestion(item), context.resolveText, context.locale),
      );
    }
    // The honeypot decoy is the last child of every step (task 026): a real
    // respondent never reaches it; a blind form-filler trips it and 020 flags
    // the session. Appending last keeps it out of the natural field order.
    children.push(honeypotNode());
    const root: A2UINode = {
      type: "Form",
      children: [{ type: "Flex", props: { direction: "column", gap: "md" }, children }],
    };
    return { stepId: step.stepId, root };
  },
};
