import { FormId, InstanceId, QuestionId, StepId } from "@roonga/qcms-core";

/**
 * The builder's two facts, built in the browser from ids, enums and bounded numbers only,
 * in the shape the API's strict `PreviewSelectionFact` and `LayoutReportFact` accept.
 */

export type FactDevice = "phone" | "tablet" | "desktop" | "custom";

export interface FactViewport {
  readonly width: number;
  readonly height: number;
}

export interface PreviewSelectionFact {
  readonly fact: "preview-selection";
  readonly formId: string;
  readonly stepId: string;
  readonly questionId: string;
  readonly instanceId?: string;
  readonly device: FactDevice;
  readonly viewport: FactViewport;
}

export const LAYOUT_ISSUES = [
  "overflow-horizontal",
  "clipped",
  "truncated-label",
  "target-too-small",
  "overlap",
  "off-screen",
] as const;
export type LayoutIssue = (typeof LAYOUT_ISSUES)[number];

export interface LayoutFinding {
  readonly questionId: string;
  readonly issue: LayoutIssue;
}

export interface LayoutReportFact {
  readonly fact: "layout-report";
  readonly formId: string;
  readonly stepId: string;
  readonly device: FactDevice;
  readonly viewport: FactViewport;
  readonly orientation: "portrait" | "landscape";
  readonly zoomPercent: number;
  readonly colorScheme: "light" | "dark";
  readonly highContrast: boolean;
  readonly pageHeight: number;
  readonly findings: readonly LayoutFinding[];
}

const FACT_ID_MAX = 128;
const FINDINGS_MAX = 50;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function viewportOf(viewport: FactViewport): FactViewport {
  return { width: clamp(viewport.width, 200, 4_000), height: clamp(viewport.height, 200, 4_000) };
}

function idOk(schema: { safeParse: (value: unknown) => { success: boolean } }, value: string) {
  return value.length <= FACT_ID_MAX && schema.safeParse(value).success;
}

/** `undefined` when any id is not one, so a fact never carries a string that is not an id. */
export function selectionFact(input: {
  readonly formId: string;
  readonly stepId: string;
  readonly questionId: string;
  readonly instanceId?: string | undefined;
  readonly device: FactDevice;
  readonly viewport: FactViewport;
}): PreviewSelectionFact | undefined {
  if (!idOk(FormId, input.formId) || !idOk(StepId, input.stepId)) return undefined;
  if (!idOk(QuestionId, input.questionId)) return undefined;
  if (input.instanceId !== undefined && !idOk(InstanceId, input.instanceId)) return undefined;
  return {
    fact: "preview-selection",
    formId: input.formId,
    stepId: input.stepId,
    questionId: input.questionId,
    ...(input.instanceId === undefined ? {} : { instanceId: input.instanceId }),
    device: input.device,
    viewport: viewportOf(input.viewport),
  };
}

export function layoutReportFact(input: {
  readonly formId: string;
  readonly stepId: string;
  readonly device: FactDevice;
  readonly viewport: FactViewport;
  readonly zoomPercent: number;
  readonly colorScheme: "light" | "dark";
  readonly highContrast: boolean;
  readonly pageHeight: number;
  readonly findings: readonly LayoutFinding[];
}): LayoutReportFact | undefined {
  if (!idOk(FormId, input.formId) || !idOk(StepId, input.stepId)) return undefined;
  const viewport = viewportOf(input.viewport);
  return {
    fact: "layout-report",
    formId: input.formId,
    stepId: input.stepId,
    device: input.device,
    viewport,
    orientation: viewport.height >= viewport.width ? "portrait" : "landscape",
    zoomPercent: clamp(input.zoomPercent, 25, 400),
    colorScheme: input.colorScheme,
    highContrast: input.highContrast,
    pageHeight: clamp(input.pageHeight, 0, 100_000),
    findings: input.findings
      .filter((finding) => idOk(QuestionId, finding.questionId))
      .slice(0, FINDINGS_MAX),
  };
}

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** What the collector read of one question's box in the frame, in frame pixels. */
export interface MeasuredQuestion {
  readonly questionId: string;
  readonly box: Box;
  /** The widest descendant scrolls past its own box. */
  readonly overflows: boolean;
  /** A descendant hides content behind `overflow: hidden` or a fixed height. */
  readonly clipped: boolean;
  /** The label's text is cut off by an ellipsis or its box. */
  readonly labelTruncated: boolean;
  /** An interactive target below 24 by 24 pixels (WCAG 2.5.8). */
  readonly smallTarget: boolean;
}

/** Tolerates the sub-pixel rounding every layout engine leaves on a box edge. */
const EDGE = 1;

function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.right - EDGE &&
    b.left < a.right - EDGE &&
    a.top < b.bottom - EDGE &&
    b.top < a.bottom - EDGE
  );
}

/** One finding per question and issue, in document order. */
export function layoutFindings(
  measured: readonly MeasuredQuestion[],
  frameWidth: number,
): LayoutFinding[] {
  const findings: LayoutFinding[] = [];
  const seen = new Set<string>();
  const add = (questionId: string, issue: LayoutIssue): void => {
    const key = `${questionId}:${issue}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ questionId, issue });
  };
  measured.forEach((question, index) => {
    if (question.overflows) add(question.questionId, "overflow-horizontal");
    if (question.clipped) add(question.questionId, "clipped");
    if (question.labelTruncated) add(question.questionId, "truncated-label");
    if (question.smallTarget) add(question.questionId, "target-too-small");
    if (question.box.left < -EDGE || question.box.right > frameWidth + EDGE) {
      add(question.questionId, "off-screen");
    }
    for (const earlier of measured.slice(0, index)) {
      if (earlier.questionId !== question.questionId && overlaps(earlier.box, question.box)) {
        add(question.questionId, "overlap");
      }
    }
  });
  return findings;
}
