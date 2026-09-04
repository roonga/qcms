import type { ReactNode } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { BrandMark } from "@/components/brand-mark";
import { t } from "@/lib/i18n/en";

export interface StepProgress {
  readonly current: number;
  readonly total: number;
}

/**
 * The respondent page chrome (screen contract `page` region): the config-driven brand
 * mark, the progress text and the appearance disclosure, then the main content
 * column. Minimal by design - respondents never navigate freely, so there is no
 * nav. Mobile-first: a single centered column that stays comfortable on a phone
 * and caps its width on larger screens (ADR-26). Adopters re-skin via tokens
 * (adopter-theme.css), never this markup.
 *
 * The brand mark and the appearance controls both read the appearance context
 * (task 053) rather than taking props, which keeps this component's six call
 * sites - one of them a client component - unchanged; see
 * `components/appearance-context.tsx` for why that is the shape.
 *
 * The appearance controls are a collapsed `<details>` rather than three visible
 * control rows. At a phone width three chip groups plus a font select would be
 * most of the viewport above the first question, and the header's job is to stay
 * out of the way of the form; a respondent who needs High-contrast or a
 * legibility face opens it once and never again, because the choice persists.
 */
export function PortalShell({
  progress,
  children,
}: {
  readonly progress?: StepProgress | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-(--color-border) bg-(--color-surface)">
        {/* `relative` is the anchor for the appearance panel, which is positioned
            below this row rather than inside it: a panel that expanded the header
            would push the first question down the page every time it opened. */}
        <div className="relative mx-auto flex w-full max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <BrandMark />
          {progress ? (
            <p
              aria-live="polite"
              className="text-sm text-(--color-text-muted)"
              data-testid="progress"
            >
              {t("progress.step", {
                current: progress.current,
                total: progress.total,
              })}
            </p>
          ) : null}
          <div className="ms-auto">
            <AppearanceControls />
          </div>
        </div>
      </header>

      <main id="portal-main" className="flex-1 px-4 py-6 sm:py-10">
        <div className="mx-auto w-full max-w-2xl">
          <div
            data-testid="step-card"
            className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-(--space-section-pad) shadow-sm"
          >
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
