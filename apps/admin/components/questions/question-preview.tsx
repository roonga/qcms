"use client";

import { A2UIStepRenderer, type A2UIStepDocument } from "@qcms/ui";

import { t } from "@/lib/i18n/en";
import type { PreviewDocument } from "@/lib/questions/types";

/**
 * The read-only single-question preview (task 032, exit criterion 3).
 *
 * ## The mechanism, and why this one
 *
 * The document rendered here is compiled **by the API**, at
 * `GET /admin/questions/{id}/versions/{v}/preview`, and this component only renders it.
 * The task left the choice open (a preview endpoint reusing 011, or compiling in the
 * admin from the definition the API returns); the endpoint won on two counts.
 *
 * 1. **R2 stays exact.** Compiling in the admin would put `@qcms/a2ui-compiler` - and
 *    `@qcms/core` behind it - inside the BFF, which is precisely the capability the
 *    import-surface test exists to keep out. It would also need a cast at the boundary,
 *    because the compiler wants a kernel-parsed `QuestionDefinition` and all a proxy has
 *    is JSON it is not allowed to validate. A cast at a rule boundary is the smell that
 *    settled this.
 * 2. **Fidelity becomes structural rather than coincidental.** Preview and publish now
 *    run the same `questionToNode` in the same process, so they cannot drift even by a
 *    version skew between two deployables.
 *
 * The cost is one API route, which task 034's form-level preview reuses.
 *
 * This is a **recompilation of a possibly unpublished draft**, which is exactly why it
 * lives on the admin surface and nowhere near the serving path: the portal serves the
 * stored compiled document and never recompiles (ADR-18).
 *
 * ## There is only one renderer
 *
 * `A2UIStepRenderer` from `@qcms/ui` is the same component the portal serves respondents
 * with (ARCHITECTURE §6). No admin-side rendering of A2UI exists anywhere else, which
 * `questions-import-surface.test.ts` asserts rather than trusts.
 *
 * ## Why it is left interactive
 *
 * The renderer is controlled and this component passes no `onChange`, so nothing an
 * operator types is recorded, read, or sent. It is deliberately NOT disabled or `inert`:
 * a disabled copy of a control is not what a respondent sees (it is greyed, it is not
 * focusable, and a screen reader skips it), so disabling it would trade the one property
 * the preview exists to provide. The note above it says so in words.
 */
export function QuestionPreview({ preview }: { readonly preview: PreviewDocument }) {
  // `root` crosses the wire as `unknown` because the A2UI node tree is opaque to both
  // the API's schema and this BFF: the renderer's registry is the only thing that knows
  // what a node means. Naming the renderer's own prop type keeps that narrowing here,
  // where the renderer is, instead of inventing a node type the admin would then own.
  const document: A2UIStepDocument = {
    stepId: preview.stepId,
    root: preview.root as A2UIStepDocument["root"],
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-(--color-text-muted)">{t("questions.preview.note")}</p>
      <div className="qcms-preview">
        <A2UIStepRenderer document={document} specVersion={preview.a2uiSpecVersion} />
      </div>
    </div>
  );
}
