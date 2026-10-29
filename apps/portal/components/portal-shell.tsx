import type { ReactNode } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { BrandMark } from "@/components/brand-mark";
import { t } from "@/lib/i18n/en";

export interface StepProgress {
  readonly current: number;
  readonly total: number;
  /**
   * The instance this page is, when a repeating group paginates the step. The indicator
   * counts views (ADR-28), so without the name a three-vehicle group reads as three
   * unrelated steps.
   */
  readonly label?: string | undefined;
}

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
        {/* `relative` anchors the appearance panel below this row rather than inside
            it: a panel that expanded the header would push the first question down the
            page every time it opened. */}
        <div className="relative mx-auto flex w-full max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <BrandMark />
          {progress ? (
            <p
              aria-live="polite"
              className="text-sm text-(--color-text-muted)"
              data-testid="progress"
            >
              {progress.label === undefined
                ? t("progress.step", { current: progress.current, total: progress.total })
                : t("progress.stepNamed", {
                    current: progress.current,
                    total: progress.total,
                    label: progress.label,
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
