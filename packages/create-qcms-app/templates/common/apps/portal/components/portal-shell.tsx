import type { ReactNode } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { BrandMark } from "@/components/brand-mark";
import { RailFold, SideRail, type RailNavigation } from "@/components/step-rail";
import { t } from "@/lib/i18n/en";
import type { ApiProgressMode, ApiRailStep } from "@/lib/server/api";

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

export interface StepRailProps extends RailNavigation {
  readonly mode: ApiProgressMode;
  readonly steps: readonly ApiRailStep[];
}

export function progressText(progress: StepProgress): string {
  return progress.label === undefined
    ? t("progress.step", { current: progress.current, total: progress.total })
    : t("progress.stepNamed", {
        current: progress.current,
        total: progress.total,
        label: progress.label,
      });
}

/** Whether the header's polite indicator names each page, so the flow need not. */
export function indicatorAnnounces(rail: StepRailProps | undefined): boolean {
  return (rail?.mode ?? "top-indicator") === "top-indicator";
}

export function PortalShell({
  progress,
  rail,
  children,
}: {
  readonly progress?: StepProgress | undefined;
  readonly rail?: StepRailProps | undefined;
  readonly children: ReactNode;
}) {
  const mode = rail?.mode ?? "top-indicator";
  const sideRail = mode === "side-rail" && rail !== undefined && rail.steps.length > 0;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-(--color-border) bg-(--color-surface)">
        {/* `relative` anchors the appearance panel below this row rather than inside
            it: a panel that expanded the header would push the first question down the
            page every time it opened. */}
        <div className="relative mx-auto flex w-full max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <BrandMark />
          {progress && mode === "top-indicator" ? (
            <p
              aria-live="polite"
              className="text-sm text-(--color-text-muted)"
              data-testid="progress"
            >
              {progressText(progress)}
            </p>
          ) : null}
          <div className="ms-auto">
            <AppearanceControls />
          </div>
        </div>
      </header>

      {sideRail ? (
        <>
          {progress ? (
            // Keyed by page, so a jump made from the open fold lands with it closed.
            <RailFold
              key={progress.current}
              steps={rail.steps}
              navigation={rail}
              summary={progressText(progress)}
            />
          ) : null}
          <div className="mx-auto flex w-full max-w-6xl flex-1 gap-8 px-4 py-6 sm:py-10">
            <SideRail steps={rail.steps} navigation={rail} />
            <main id="portal-main" className="min-w-0 flex-1">
              <StepCard>{children}</StepCard>
            </main>
          </div>
        </>
      ) : (
        <main id="portal-main" className="flex-1 px-4 py-6 sm:py-10">
          <StepCard>{children}</StepCard>
        </main>
      )}
    </div>
  );
}

function StepCard({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <div
        data-testid="step-card"
        className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-(--space-section-pad) shadow-sm"
      >
        {children}
      </div>
    </div>
  );
}
