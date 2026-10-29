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
 * The step-resolver seam (ARCHITECTURE §12, `docs/agent-seam.md`). Compile-time
 * only: the serving path never sees an LLM (ADR-25) and serves the stored
 * document (ADR-18).
 */

/** Everything a resolver needs to compile one step; it does no I/O (R3). */
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
 * static implementation; an adaptive one may branch on a richer context.
 */
export interface StepResolver {
  readonly resolveStep: (step: Step, context: StepResolverContext) => A2UIDocument;
}

/**
 * Heading typography is stated in the compiled document, served forever (ADR-18), so a
 * foreign renderer has the intent. Values are the `Text` schema's own enums (ADR-22).
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
      // The compiler is answer-blind, so it cannot expand a group itself.
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
    // Last child of the step, out of the field order a respondent follows.
    children.push(honeypotNode());
    const root: A2UINode = {
      type: "Form",
      children: [{ type: "Flex", props: { direction: "column", gap: "md" }, children }],
    };
    return { stepId: step.stepId, root };
  },
};
