"use client";

import {
  A2UIStepRenderer,
  type A2UIAnswerValue,
  type A2UIStepDocument,
  type A2UIValues,
} from "@roonga/qcms-ui";
import { useCallback, useState } from "react";

import { Button } from "@/components/kit";
import { PreviewThemeIsland } from "@/components/preview-theme-island";
import type { FormVersionSnapshot } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { VERSION_HEADING_ID } from "@/lib/page-headings";
import type { PreviewTheme } from "@/lib/preview-theme";

/**
 * One published version, rendered from its **stored** compiled documents (task 034;
 * screen contract "version history", ADR-18).
 *
 * ## Why this is not a preview
 *
 * The draft preview compiles. This does not, and must not: the audit promise is "here is
 * exactly what a respondent on v2 saw", and a recompilation could only weaken it - a newer
 * compiler, a newer question version, a newer default, and the screen would be showing
 * something that was never served. So the documents come out of the version's JSONB, which
 * is the copy `insertFormVersion` froze at publish time, and the only endpoint this screen
 * touches is `GET /admin/forms/{id}/versions/{v}`.
 *
 * That is a property worth asserting rather than trusting, and the Playwright suite does:
 * no draft-preview request is made anywhere on a history page.
 *
 * ## Why the controls still work
 *
 * The same reasoning 032's question preview arrived at. A disabled copy of a control is not
 * what a respondent saw - it is greyed, unfocusable, and skipped by a screen reader - so
 * disabling would trade away the property this screen exists to show. The renderer is
 * *controlled*, so values without an `onChange` would not be read-only but frozen (a
 * checkbox that cannot be ticked), which is why this component owns an answers map. There
 * is no session, no posting, and no persistence of any kind: the state dies with the
 * component, and switching version resets it.
 *
 * "Read only" on this screen means the **definition** is immutable (R1), which is what the
 * copy says.
 *
 * ## The same styling seam as the draft preview
 *
 * The rendered step hangs off one `qcms-preview-surface` container, which owns its styling
 * boundary and assumes nothing about the admin's theme context (Code Owner ruling,
 * 2026-08-02). A published version is the strongest case for that boundary being real: what
 * it shows is what a respondent saw, so the admin's own chrome has no business leaking into
 * it. Task 058 mounted the theme island on that container and moved the container's markup
 * into `PreviewThemeIsland`, which all three preview surfaces now render through, so what
 * this screen shows is a respondent's appearance under a theme the author can change.
 */
export function VersionView({
  snapshot,
  defaultTheme,
}: {
  readonly snapshot: FormVersionSnapshot;
  /** The deployment's configured portal theme, read on the server by the page. */
  readonly defaultTheme: PreviewTheme;
}) {
  const [answers, setAnswers] = useState<{ key: number; values: A2UIValues }>({
    key: snapshot.version,
    values: {},
  });
  const [stepIndex, setStepIndex] = useState(0);

  // Reset during render rather than in an effect, so v2's controls never paint one frame
  // holding v1's typed answers. This is React's sanctioned "adjusting state when props
  // change": the component re-runs immediately and the intermediate render is never
  // committed, which an effect cannot promise - it would commit the stale frame first.
  //
  // The step index resets on the SAME condition, and it has to be this one rather than a
  // clamp. `Math.min` below keeps the index in range, so nothing crashes, but a reader
  // moving from a five-step version to a two-step one would land on its last step rather
  // than its first: no error, just the wrong place, which is the harder kind to notice.
  if (answers.key !== snapshot.version) {
    setAnswers({ key: snapshot.version, values: {} });
    setStepIndex(0);
  }

  const handleChange = useCallback((name: string, value: A2UIAnswerValue | undefined): void => {
    setAnswers((previous) => {
      const values = { ...previous.values };
      if (value === undefined) delete values[name];
      else values[name] = value;
      return { key: previous.key, values };
    });
  }, []);

  const steps = snapshot.documents;
  const index = steps.length === 0 ? 0 : Math.min(stepIndex, steps.length - 1);
  const step = steps[index];

  return (
    // Labelled by the route's own <h1>, which names this version (issue #510). This
    // component used to head itself "Viewing v{n}" under a page heading that named the
    // form; the version is the page's subject, so it is the page's heading, and saying it
    // again one level down would only pad the outline.
    <section
      aria-labelledby={VERSION_HEADING_ID}
      className="flex flex-col gap-4"
      data-testid="qcms-version-view"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-version-stored">
          {t("forms.history.stored", { version: snapshot.version })}
        </p>
        <p className="text-sm text-(--color-text-muted)">{t("forms.history.readOnly")}</p>
        <p className="text-xs text-(--color-text-muted)">
          {t("forms.preview.stamps", {
            compilerVersion: snapshot.compilerVersion,
            a2uiSpecVersion: snapshot.a2uiSpecVersion,
          })}
        </p>
      </div>

      {step === undefined ? (
        <p className="text-sm text-(--color-text-muted)">{t("forms.preview.noSteps")}</p>
      ) : (
        <>
          <p className="text-sm text-(--color-text-muted)" data-testid="qcms-version-step">
            {t("forms.history.stepOf", {
              index: index + 1,
              total: steps.length,
              title: step.stepId,
            })}
          </p>

          <PreviewThemeIsland defaultTheme={defaultTheme}>
            <A2UIStepRenderer
              document={{ stepId: step.stepId, root: step.root as A2UIStepDocument["root"] }}
              values={answers.values}
              onChange={handleChange}
              specVersion={snapshot.a2uiSpecVersion}
              // The document is embedded in a page that already has an `h1` (the route's,
              // naming the version), and it carries the outline it would have as a whole
              // page on the portal: a form-title `h1` on the first step. Rendered
              // untouched, this route had two `<h1>`s - a document-outline defect, and an
              // ambiguous heading-by-level query for every test that touches it (issue
              // #537). Only the levels move; the compiled typography is left alone, so
              // this still shows what a respondent saw.
              headingLevelOffset={1}
            />
          </PreviewThemeIsland>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              isDisabled={index === 0}
              onPress={() => {
                setStepIndex(index - 1);
              }}
            >
              {t("forms.preview.previous")}
            </Button>
            <Button
              variant="secondary"
              size="md"
              isDisabled={index >= steps.length - 1}
              onPress={() => {
                setStepIndex(index + 1);
              }}
            >
              {t("forms.preview.next")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
