import type { ReactNode } from "react";

import { t } from "@/lib/i18n/en";

export interface StepProgress {
  readonly current: number;
  readonly total: number;
}

/**
 * The respondent page chrome (wireframe `page` region): a brandable logo slot and
 * the progress text, then the main content column. Minimal by design - respondents
 * never navigate freely, so there is no nav. Mobile-first: a single centered
 * column that stays comfortable on a phone and caps its width on larger screens
 * (ADR-26). Adopters re-skin via tokens (adopter-theme.css), never this markup.
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
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-4 py-3">
          {/* Logo slot (shell theming) - adopters replace this brand mark. */}
          <span className="text-base font-semibold tracking-tight text-(--color-text)">QCMS</span>
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
        </div>
      </header>

      <main id="portal-main" className="flex-1 px-4 py-6 sm:py-10">
        <div className="mx-auto w-full max-w-2xl">
          <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-5 shadow-sm sm:p-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
