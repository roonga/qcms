import {
  isRepeatGroup,
  type FrozenSnapshot,
  type LocaleCode,
  type QuestionDefinition,
  type QuestionRef,
  type Step,
} from "@roonga/qcms-core";

import { honeypotNode } from "./honeypot.js";
import { questionToNode, type TextResolver } from "./mapping.js";
import { repeatGroupNode } from "./repeat-group.js";
import type { A2UIDocument, A2UINode } from "./types.js";

/**
 * The step-resolver seam (ARCHITECTURE §12), reserved for an adaptive resolver
 * implementing the same interface (`docs/agent-seam.md`). The seam is
 * compile-time: the serving path never sees an LLM (ADR-25) and serves the
 * stored document (ADR-18).
 */

/**
 * Everything a resolver needs to compile one step. The resolver does no I/O and
 * no lookups of its own, mirroring the kernel's R3 discipline.
 */
export interface StepResolverContext {
  readonly snapshot: FrozenSnapshot;
  readonly locale: LocaleCode;
  readonly resolveText: TextResolver;
  readonly resolveQuestion: (ref: QuestionRef) => QuestionDefinition;
  /** True for the form's first step, the only one carrying the form title. */
  readonly isFirstStep: boolean;
}

/**
 * One call per step, returning that step's document. Deterministic for the
 * static implementation; an adaptive one may branch on answers threaded through
 * a richer context in a later version of this seam.
 */
export interface StepResolver {
  readonly resolveStep: (step: Step, context: StepResolverContext) => A2UIDocument;
}

/**
 * The typography each heading level carries into the compiled document.
 *
 * The intent belongs in the document rather than in a renderer default, because
 * the document is stored and served forever (ADR-18): a renderer that changed
 * its default would silently restyle every published form, and a renderer that
 * is not ours has nothing to read the intent from. Without it a heading renders
 * at body size and weight, which axe cannot catch, since it checks that a
 * heading is one rather than that it looks like one.
 *
 * Each level differs from the next in both size and weight, which keeps the
 * hierarchy legible across the font faces the portal offers: a size step alone
 * reads differently between them in a way a weight step does not.
 *
 * The values are the `Text` schema's own enums rather than theme tokens,
 * because pointing them at tokens would mean editing a vendored component
 * (ADR-22).
 */
const HEADING_STYLE = {
  h1: { size: "2xl", weight: "bold" },
  h2: { size: "xl", weight: "semibold" },
} as const;

function heading(as: "h1" | "h2", text: string): A2UINode {
  return { type: "Text", props: { as, ...HEADING_STYLE[as] }, children: text };
}

/** The launch resolver: a pure, deterministic projection. */
export const staticStepResolver: StepResolver = {
  resolveStep(step, context) {
    const children: A2UINode[] = [];
    if (context.isFirstStep) {
      children.push(heading("h1", context.resolveText(context.snapshot.definition.title)));
    }
    children.push(heading("h2", context.resolveText(step.title)));
    for (const item of step.items) {
      // A group compiles to a template node the renderer clones per live
      // instance: the compiler is answer-blind, so it cannot expand one.
      if (isRepeatGroup(item)) {
        children.push(
          repeatGroupNode(item, context.resolveQuestion, context.resolveText, context.locale),
        );
        continue;
      }
      children.push(
        questionToNode(context.resolveQuestion(item), context.resolveText, context.locale),
      );
    }
    // The decoy is the last child of every step, which keeps it out of the
    // natural field order a respondent follows.
    children.push(honeypotNode());
    const root: A2UINode = {
      type: "Form",
      children: [{ type: "Flex", props: { direction: "column", gap: "md" }, children }],
    };
    return { stepId: step.stepId, root };
  },
};
