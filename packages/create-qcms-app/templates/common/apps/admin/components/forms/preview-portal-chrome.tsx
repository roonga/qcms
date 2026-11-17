"use client";

import type { ReactNode } from "react";

import type { PreviewRailStep } from "@/lib/forms/preview-rail";
import { t } from "@/lib/i18n/en";

/*
 * The portal shell's header, step rail and step card (`apps/portal/components/portal-shell.tsx`
 * and `step-rail.tsx`), with the same utility classes. The portal's viewport breakpoints become
 * `qcms-cq-*` classes that read the device frame's container, and its links become buttons,
 * because the preview pages itself. `preview-portal-chrome.test.ts` pins the two together.
 */

export type PreviewProgressMode = "side-rail" | "top-indicator" | "none";

export interface PreviewBrand {
  readonly name: string | undefined;
  readonly logoSrc: string | undefined;
}

export interface PreviewRailQuestion {
  readonly key: string;
  readonly label: string;
}

interface RailNavigation {
  readonly onJump: (cursor: number) => void;
  readonly onQuestion: (key: string) => void;
}

const MARKER =
  "flex size-6 flex-none items-center justify-center rounded-full border-2 text-xs font-semibold";

function Marker({ step, position }: { readonly step: PreviewRailStep; readonly position: number }) {
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

const BUTTON_RESET = "w-full cursor-pointer text-start";

function RailItem({
  step,
  position,
  navigation,
}: {
  readonly step: PreviewRailStep;
  readonly position: number;
  readonly navigation: RailNavigation;
}) {
  const marker = <Marker step={step} position={position} />;
  if (step.state === "completed" && step.cursor !== null) {
    const cursor = step.cursor;
    return (
      <button
        type="button"
        data-rail-state="completed"
        className={`${ROW} text-(--color-text) underline-offset-4 hover:bg-(--color-ghost-hover) hover:underline ${BUTTON_RESET}`}
        onClick={() => {
          navigation.onJump(cursor);
        }}
      >
        {marker}
        <span className="min-w-0 flex-1">{step.label}</span>
        <span className="text-xs text-(--color-text-muted)">
          {t("builder.preview.portal.done")}
        </span>
      </button>
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
      {step.state === "notNeeded" ? (
        <span className="text-xs">{t("builder.preview.portal.notNeeded")}</span>
      ) : null}
    </div>
  );
}

function StepList({
  steps,
  navigation,
  questions,
}: {
  readonly steps: readonly PreviewRailStep[];
  readonly navigation: RailNavigation;
  readonly questions: readonly PreviewRailQuestion[] | undefined;
}) {
  return (
    <ol className="flex flex-col gap-1">
      {steps.map((step, index) => (
        <li key={step.stepId}>
          <RailItem step={step} position={index + 1} navigation={navigation} />
          {questions !== undefined && step.state === "current" && questions.length > 1 ? (
            <ul className="ms-12 mt-1 flex flex-col gap-0.5">
              {questions.map((question) => (
                <li key={question.key}>
                  <button
                    type="button"
                    onClick={() => {
                      navigation.onQuestion(question.key);
                    }}
                    className={`flex min-h-8 items-center rounded-(--radius-control) px-3 text-sm text-(--color-text-muted) underline-offset-4 hover:text-(--color-text) hover:underline ${BUTTON_RESET}`}
                  >
                    {question.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function SideRail({
  steps,
  navigation,
  questions,
}: {
  readonly steps: readonly PreviewRailStep[];
  readonly navigation: RailNavigation;
  readonly questions: readonly PreviewRailQuestion[];
}) {
  return (
    <nav
      aria-label={t("builder.preview.portal.rail")}
      data-testid="qcms-preview-step-rail"
      className="hidden w-72 flex-none flex-col gap-4 qcms-cq-lg-flex"
    >
      <StepList steps={steps} navigation={navigation} questions={questions} />
      <p className="px-3 text-xs leading-relaxed text-(--color-text-muted)">
        {t("builder.preview.portal.hint")}
      </p>
    </nav>
  );
}

function RailFold({
  steps,
  navigation,
  summary,
}: {
  readonly steps: readonly PreviewRailStep[];
  readonly navigation: RailNavigation;
  readonly summary: string;
}) {
  const current = steps.find((step) => step.state === "current");
  return (
    <details
      data-testid="qcms-preview-step-rail-fold"
      className="group border-b border-(--color-border) bg-(--color-surface) qcms-cq-lg-hidden"
    >
      <summary className="mx-auto flex min-h-14 w-full max-w-2xl cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs text-(--color-text-muted)">{summary}</span>
          {current === undefined ? null : (
            <span className="truncate text-sm font-semibold text-(--color-text)">
              {current.label}
            </span>
          )}
        </span>
        <span className="text-xs text-(--color-text-muted)">
          {t("builder.preview.portal.toggle")}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5 flex-none fill-none stroke-current stroke-2 text-(--color-text-muted) group-open:rotate-180 motion-safe:transition-transform"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <nav
        aria-label={t("builder.preview.portal.rail")}
        className="mx-auto w-full max-w-2xl px-2 pb-3"
      >
        <StepList steps={steps} navigation={navigation} questions={undefined} />
      </nav>
    </details>
  );
}

function StepCard({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <div
        data-testid="qcms-preview-step-card"
        className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-(--space-section-pad) shadow-sm"
      >
        {children}
      </div>
    </div>
  );
}

/** The respondent's page around the previewed step: the portal header, its step indicator or rail, and the step card. */
export function PreviewPortalChrome({
  brand,
  mode,
  progress,
  steps,
  questions,
  onJump,
  onQuestion,
  children,
}: {
  readonly brand: PreviewBrand;
  readonly mode: PreviewProgressMode;
  /** `undefined` while no step is shown. */
  readonly progress: string | undefined;
  readonly steps: readonly PreviewRailStep[];
  /** The shown step's questions, which the side rail lists under it. */
  readonly questions: readonly PreviewRailQuestion[];
  readonly onJump: (cursor: number) => void;
  readonly onQuestion: (key: string) => void;
  readonly children: ReactNode;
}) {
  const sideRail = mode === "side-rail" && steps.length > 0;
  const navigation = { onJump, onQuestion };
  return (
    <div className="flex min-h-full flex-col" data-testid="qcms-preview-portal">
      <div className="border-b border-(--color-border) bg-(--color-surface)">
        <div className="relative mx-auto flex w-full max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="qcms-brand" data-testid="qcms-preview-brand">
            {brand.logoSrc === undefined ? null : (
              <img className="qcms-brand__logo" src={brand.logoSrc} alt="" />
            )}
            <span className="qcms-brand__name">
              {brand.name ?? t("builder.preview.portal.brand")}
            </span>
          </span>
          {progress !== undefined && mode === "top-indicator" ? (
            <p className="text-sm text-(--color-text-muted)" data-testid="qcms-preview-progress">
              {progress}
            </p>
          ) : null}
        </div>
      </div>

      {sideRail ? (
        <>
          {progress === undefined ? null : (
            <RailFold steps={steps} navigation={navigation} summary={progress} />
          )}
          <div className="mx-auto flex w-full max-w-6xl flex-1 gap-8 px-4 py-6 qcms-cq-sm-py-10">
            <SideRail steps={steps} navigation={navigation} questions={questions} />
            <div className="min-w-0 flex-1">
              <StepCard>{children}</StepCard>
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 px-4 py-6 qcms-cq-sm-py-10">
          <StepCard>{children}</StepCard>
        </div>
      )}
    </div>
  );
}
