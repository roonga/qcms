"use client";

import {
  A2UIStepRenderer,
  type A2UIAnswerValue,
  type A2UIStepDocument,
  type A2UIValues,
} from "@qcms/ui";
import { useCallback, useState } from "react";

import { PreviewThemeIsland } from "@/components/preview-theme-island";
import { t } from "@/lib/i18n/en";
import type { PreviewTheme } from "@/lib/preview-theme";
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
 * ## Why it is interactive, and what "interactive" had to be made to mean
 *
 * It is deliberately NOT disabled or `inert`: a disabled copy of a control is not what a
 * respondent sees (it is greyed, it is not focusable, and a screen reader skips it), so
 * disabling it would trade away the one property the preview exists to provide.
 *
 * That reasoning was right and the first implementation did not deliver it. The renderer
 * is CONTROLLED, so passing `values` without an `onChange` does not make a control
 * read-only, it makes it **frozen**: focusable, apparently live, and incapable of ever
 * showing a change, because every keystroke and click is written back as the value it
 * already had. A checkbox could not be ticked. The Code Owner found it at the gate, and
 * it also made the note below describe behaviour the control could not exhibit - the
 * note promises nothing is saved, which only means something if something can be
 * entered.
 *
 * So this component owns an answers map and passes it with an `onChange`, which is the
 * same controlled contract the portal's `step-flow.tsx` uses. The difference is entirely
 * in what is absent: there is no `postAnswer`, no fetch, no ADR-31 commit moment and no
 * persistence of any kind. The state lives in this component and dies with it - on
 * unmount, and on a version switch, which `resetKey` below makes explicit.
 *
 * ## The styling seam, and the theme island on it
 *
 * Task 034 gave the two form-level previews a single `qcms-preview-surface` container
 * that owns the preview's styling boundary; this screen had only the plain
 * `.qcms-preview` box. Task 058 moved the seam's markup into `PreviewThemeIsland`, so
 * all three surfaces mount one container, and this screen joins them by rendering
 * through it rather than by growing a container of its own. What the author gets is the
 * respondent token set inside the box and the authoring app's Cobalt outside it, with a
 * theme and mode switcher above.
 */
export function QuestionPreview({
  preview,
  resetKey,
  defaultTheme,
}: {
  readonly preview: PreviewDocument;
  /**
   * The deployment's configured portal theme, read on the server by the page.
   *
   * A prop rather than a read here, because this is a client component and
   * `lib/server/` is unreachable from one (R2), and because the island has to be
   * portal-themed in its first paint rather than after a round trip.
   */
  readonly defaultTheme: PreviewTheme;
  /**
   * Discards the typed answers when it changes. The selected version, in practice.
   *
   * It has to be passed in, because the thing that actually changes between versions is
   * not visible here: the API stamps every preview with the same constant `stepId`, so
   * `preview` alone cannot tell one version's document from another's. And the switch is
   * a `?v=` navigation on the SAME route, so React reconciles this component in place
   * and keeps its state unless something says otherwise. Without this, v1's typed
   * answers would reappear underneath v2's controls.
   */
  readonly resetKey: string | number;
}) {
  // `root` crosses the wire as `unknown` because the A2UI node tree is opaque to both
  // the API's schema and this BFF: the renderer's registry is the only thing that knows
  // what a node means. Naming the renderer's own prop type keeps that narrowing here,
  // where the renderer is, instead of inventing a node type the admin would then own.
  const document: A2UIStepDocument = {
    stepId: preview.stepId,
    root: preview.root as A2UIStepDocument["root"],
  };

  // Reset during render rather than in an effect: an effect would paint one frame of the
  // previous version's answers under the new version's controls before clearing them.
  const [answers, setAnswers] = useState<{ key: string | number; values: A2UIValues }>({
    key: resetKey,
    values: {},
  });
  if (answers.key !== resetKey) setAnswers({ key: resetKey, values: {} });

  const handleChange = useCallback((name: string, value: A2UIAnswerValue | undefined): void => {
    setAnswers((previous) => {
      const values = { ...previous.values };
      // Deleting rather than storing `undefined` is what the portal does and it matters
      // for the same reason (COMPONENT_GUIDELINES item 11): the adapters read "no answer"
      // as an absent key, and a present key holding `undefined` sends react-aria down its
      // uncontrolled path, where a control serves its own last internal value instead of
      // the one passed to it.
      if (value === undefined) delete values[name];
      else values[name] = value;
      return { key: previous.key, values };
    });
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-(--color-text-muted)">{t("questions.preview.note")}</p>
      <PreviewThemeIsland defaultTheme={defaultTheme}>
        <A2UIStepRenderer
          document={document}
          specVersion={preview.a2uiSpecVersion}
          values={answers.values}
          onChange={handleChange}
        />
      </PreviewThemeIsland>
    </div>
  );
}
