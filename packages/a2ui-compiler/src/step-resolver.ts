import type { FrozenSnapshot, LocaleCode, QuestionDefinition, QuestionRef, Step } from "@qcms/core";

import { honeypotNode } from "./honeypot.js";
import { questionToNode, type TextResolver } from "./mapping.js";
import type { A2UIDocument, A2UINode } from "./types.js";

/**
 * The step-resolver seam (task 011, ARCHITECTURE §12 - "Step-resolver /
 * compiler swap"). `compileForm` produces every step's document through a
 * {@link StepResolver}; the {@link staticStepResolver} is the launch
 * implementation (a deterministic projection of the pinned domain model). The
 * reserved Phase-4 extension is an agent/adaptive resolver implementing the
 * same interface to produce documents that respond to prior answers - see
 * `docs/agent-seam.md`. The seam is *authoring/compile-time*; the serving path
 * never sees an LLM (ADR-25) and serves the stored document (ADR-18).
 */

/**
 * Everything a resolver needs to compile one step, assembled by `compileForm`
 * from the frozen snapshot. The resolver does no I/O and no lookups of its own
 * (mirrors the kernel's R3 discipline - state is passed in).
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
  /** True for the form's first step - only then is the form-title `h1` emitted. */
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

/**
 * The typography each heading level carries into the compiled document (issue #186).
 *
 * ## Why the compiler sets these at all
 *
 * `heading()` used to emit `{ as }` and nothing else, and the vendored `Text` component
 * defaults the two props that carry visual weight (`size: "md"`, `weight: "normal"` in
 * `packages/ui/src/components/a2ui/text/text.styles.ts`). So every compiled form title and
 * step title rendered at body size and body weight: semantically correct `h1`/`h2`
 * elements that a sighted respondent could not tell apart from the question labels around
 * them. Nothing caught it and nothing could - axe checks that a heading IS a heading, not
 * that it LOOKS like one, so `a11y-axe.pw.ts` passed throughout.
 *
 * The intent belongs in the document rather than in a renderer default, because the
 * document is what is stored and served forever (ADR-18): a renderer that later changed
 * its default would silently restyle every published form, and a renderer that is not ours
 * has nothing to read the intent from at all. The corpus is the renderer-compat contract
 * (`golden/README.md`), so a prop that appears here is a prop the renderer must honour.
 *
 * ## Why two steps of contrast rather than one
 *
 * The form title is the page; the step title is a section of it. `2xl/bold` against
 * `xl/semibold` against the body's `md/normal` gives each of the three a distinct size AND
 * weight, which is what keeps the hierarchy legible across a respondent's own font choice:
 * the portal offers several faces (`QCMS_PORTAL_FONTS`), and a size step alone reads
 * differently between them in a way a weight step does not.
 *
 * Values come from the `Text` schema's own enums (`xs`…`2xl`, `normal`…`bold`), not from a
 * `--type-*` theme token. Pointing them at tokens would mean editing the vendored `Text`
 * component, which is a byte-for-byte upstream copy (ADR-22) and outside this fix, so
 * `--type-step-title` still has no consumer inside the renderer. That is the half of #186
 * left standing, and it is reported rather than forced.
 */
const HEADING_STYLE = {
  h1: { size: "2xl", weight: "bold" },
  h2: { size: "xl", weight: "semibold" },
} as const;

/** A `Text` heading node (`h1` form title, `h2` step title) - the page outline. */
function heading(as: "h1" | "h2", text: string): A2UINode {
  return { type: "Text", props: { as, ...HEADING_STYLE[as] }, children: text };
}

/**
 * The launch resolver: a pure, deterministic projection. Each step compiles to
 * `Form → Flex(column)` carrying the heading structure (form title `h1` on the
 * first step, step title `h2` on every step), one control node per pinned
 * question, and - last - one visually-hidden honeypot decoy (abuse controls,
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
