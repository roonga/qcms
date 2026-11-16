import type { MouseEvent } from "react";

import { t } from "@/lib/i18n/en";
import type { ApiRailStep } from "@/lib/server/api";

export interface RailNavigation {
  /** The flow page's address; a completed step links to it with its cursor. */
  readonly stepHref: string;
  /** The scripted flow takes the jump itself; without it the link is a plain page load. */
  readonly onJump?: ((cursor: number) => void) | undefined;
  /** Moves focus into a question; without it the link is a fragment jump. */
  readonly onQuestion?: ((key: string) => void) | undefined;
}

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

const MARKER =
  "flex size-6 flex-none items-center justify-center rounded-full border-2 text-xs font-semibold";

function Marker({ step, position }: { readonly step: ApiRailStep; readonly position: number }) {
  switch (step.state) {
    case "completed":
      return (
        <span
          aria-hidden="true"
          className={`${MARKER} border-(--color-primary) bg-(--color-primary) text-(--color-primary-foreground)`}
        >
          ✓
        </span>
      );
    case "current":
      return (
        <span
          aria-hidden="true"
          className={`${MARKER} border-(--color-primary) bg-(--color-surface) text-(--color-text)`}
        >
          {position}
        </span>
      );
    case "notNeeded":
      return (
        <span
          aria-hidden="true"
          className={`${MARKER} border-dashed border-(--color-border-strong) text-(--color-text-muted)`}
        >
          {position}
        </span>
      );
    default:
      return (
        <span
          aria-hidden="true"
          className={`${MARKER} border-(--color-border-strong) text-(--color-text-muted)`}
        >
          {position}
        </span>
      );
  }
}

const ROW = "flex min-h-11 items-center gap-3 rounded-(--radius-control) px-3 py-2 text-sm";

function RailItem({
  step,
  position,
  navigation,
}: {
  readonly step: ApiRailStep;
  readonly position: number;
  readonly navigation: RailNavigation;
}) {
  const marker = <Marker step={step} position={position} />;
  if (step.state === "completed" && step.cursor !== null) {
    const cursor = step.cursor;
    const { onJump } = navigation;
    return (
      <a
        href={`${navigation.stepHref}?step=${String(cursor)}`}
        data-rail-state="completed"
        className={`${ROW} text-(--color-text) underline-offset-4 hover:bg-(--color-ghost-hover) hover:underline`}
        onClick={
          onJump === undefined
            ? undefined
            : (event) => {
                if (!isPlainClick(event)) return;
                event.preventDefault();
                onJump(cursor);
              }
        }
      >
        {marker}
        <span className="min-w-0 flex-1">{step.label}</span>
        <span className="text-xs text-(--color-text-muted)">{t("rail.done")}</span>
      </a>
    );
  }
  if (step.state === "current") {
    return (
      <div
        aria-current="step"
        data-rail-state="current"
        className={`${ROW} border border-(--color-border) bg-(--color-surface) font-semibold text-(--color-text)`}
      >
        {marker}
        <span className="min-w-0 flex-1">{step.label}</span>
      </div>
    );
  }
  return (
    <div data-rail-state={step.state} className={`${ROW} text-(--color-text-muted)`}>
      {marker}
      <span className="min-w-0 flex-1">{step.label}</span>
      {step.state === "notNeeded" ? <span className="text-xs">{t("rail.notNeeded")}</span> : null}
    </div>
  );
}

export function StepList({
  steps,
  navigation,
  questions,
}: {
  readonly steps: readonly ApiRailStep[];
  readonly navigation: RailNavigation;
  readonly questions: boolean;
}) {
  return (
    <ol className="flex flex-col gap-1">
      {steps.map((step, index) => (
        <li key={step.stepId}>
          <RailItem step={step} position={index + 1} navigation={navigation} />
          {questions && step.state === "current" && (step.questions?.length ?? 0) > 1 ? (
            <ul className="ms-12 mt-1 flex flex-col gap-0.5">
              {step.questions?.map((question) => (
                <li key={question.key}>
                  <a
                    href={`#${question.key}`}
                    onClick={
                      navigation.onQuestion === undefined
                        ? undefined
                        : (event) => {
                            if (!isPlainClick(event)) return;
                            event.preventDefault();
                            navigation.onQuestion?.(question.key);
                          }
                    }
                    className="flex min-h-8 items-center rounded-(--radius-control) px-3 text-sm text-(--color-text-muted) underline-offset-4 hover:text-(--color-text) hover:underline"
                  >
                    {question.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function SideRail({
  steps,
  navigation,
}: {
  readonly steps: readonly ApiRailStep[];
  readonly navigation: RailNavigation;
}) {
  return (
    <nav
      aria-label={t("rail.label")}
      data-testid="step-rail"
      className="hidden w-72 flex-none flex-col gap-4 lg:flex"
    >
      <StepList steps={steps} navigation={navigation} questions />
      <p className="px-3 text-xs leading-relaxed text-(--color-text-muted)">{t("rail.hint")}</p>
    </nav>
  );
}

/**
 * Below the breakpoint the rail folds into a top indicator. A native disclosure, so it
 * opens without script and the keyboard and screen-reader semantics come with it.
 */
export function RailFold({
  steps,
  navigation,
  summary,
}: {
  readonly steps: readonly ApiRailStep[];
  readonly navigation: RailNavigation;
  readonly summary: string;
}) {
  const current = steps.find((step) => step.state === "current");
  return (
    <details
      data-testid="step-rail-fold"
      className="group border-b border-(--color-border) bg-(--color-surface) lg:hidden"
    >
      <summary className="mx-auto flex min-h-14 w-full max-w-2xl cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs text-(--color-text-muted)" data-testid="progress-fold">
            {summary}
          </span>
          {current === undefined ? null : (
            <span className="truncate text-sm font-semibold text-(--color-text)">
              {current.label}
            </span>
          )}
        </span>
        <span className="text-xs text-(--color-text-muted)">{t("rail.toggle")}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5 flex-none fill-none stroke-current stroke-2 text-(--color-text-muted) group-open:rotate-180 motion-safe:transition-transform"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <nav aria-label={t("rail.label")} className="mx-auto w-full max-w-2xl px-2 pb-3">
        <StepList steps={steps} navigation={navigation} questions={false} />
      </nav>
    </details>
  );
}
