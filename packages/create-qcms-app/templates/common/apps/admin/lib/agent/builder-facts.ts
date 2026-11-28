/**
 * The builder's three facts, built in the browser from ids, enums, hex colours and bounded
 * numbers only, in the shape the API's strict `PreviewSelectionFact`, `LayoutReportFact` and
 * `DerivedThemeFact` accept.
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

/** The kernel's id grammar, restated because the admin runs no kernel code. */
function idPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}_[a-z0-9_]+$`, "u");
}

const FormId = idPattern("frm");
const StepId = idPattern("stp");
const QuestionId = idPattern("q");
const InstanceId = idPattern("ins");

function idOk(pattern: RegExp, value: string): boolean {
  return value.length <= FACT_ID_MAX && pattern.test(value);
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

export const PALETTE_KINDS = ["light", "dark", "lightHighContrast", "darkHighContrast"] as const;
export type FactPaletteKind = (typeof PALETTE_KINDS)[number];

export type FactPalette = Readonly<Record<string, string>>;

export interface FactCorrection {
  readonly palette: FactPaletteKind;
  /** The colour's part in the palette. `token` is in the vocabulary the fact walk refuses. */
  readonly role: string;
  readonly from: string;
  readonly to: string;
}

export interface DerivedThemeFact {
  readonly fact: "derived-theme";
  readonly formId: string;
  readonly palettes: Readonly<Record<FactPaletteKind, FactPalette>>;
  readonly face: string;
  readonly pageTint: boolean;
  /** Whether a logo came with it. The key itself stays in the browser, never in a fact (M2). */
  readonly hasLogo: boolean;
  readonly corrections: readonly FactCorrection[];
  readonly tintDropped: readonly FactPaletteKind[];
}

/** The grammars the API's strict fact schema holds each value to, restated as above. */
const Hex = /^#[0-9a-f]{6}$/u;
const Face = /^[a-z0-9]+$/u;
const Role = /^[a-z]+(-[a-z]+)*$/u;
const CORRECTIONS_MAX = 200;

function hex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const lower = value.toLowerCase();
  return Hex.test(lower) ? lower : undefined;
}

/** `undefined` when any colour is not a hex colour, so no free string can ride in one. */
function palette(raw: unknown): FactPalette | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const colours: Record<string, string> = {};
  for (const [token, value] of Object.entries(raw)) {
    const colour = hex(value);
    if (!Role.test(token) || colour === undefined) return undefined;
    colours[token] = colour;
  }
  return Object.keys(colours).length === 0 ? undefined : colours;
}

function correction(raw: unknown): FactCorrection | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const row = raw as Record<string, unknown>;
  const kind = row["palette"];
  const role = row["token"];
  const from = hex(row["from"]);
  const to = hex(row["to"]);
  if (typeof kind !== "string" || !isPaletteKind(kind)) return undefined;
  if (typeof role !== "string" || !Role.test(role)) return undefined;
  if (from === undefined || to === undefined) return undefined;
  return { palette: kind, role, from, to };
}

function isPaletteKind(value: string): value is FactPaletteKind {
  return (PALETTE_KINDS as readonly string[]).includes(value);
}

/**
 * What a derive lets the next turn see: the colours, the face and the tint, whether a logo came
 * with it, and what was moved to keep it readable. No host, no logo key and no page text, and
 * `undefined` rather than a fact whose every value is not one of those shapes (SEC-18 M1, M2).
 */
export function derivedThemeFact(input: {
  readonly formId: string;
  readonly palettes: unknown;
  readonly face: string;
  readonly pageTint: boolean;
  readonly logoKey: string | null;
  readonly corrections: readonly unknown[];
  readonly tintDropped: readonly string[];
}): DerivedThemeFact | undefined {
  if (!idOk(FormId, input.formId) || !Face.test(input.face)) return undefined;
  const palettes = {} as Record<FactPaletteKind, FactPalette>;
  for (const kind of PALETTE_KINDS) {
    const read = palette((input.palettes as Record<string, unknown> | null)?.[kind]);
    if (read === undefined) return undefined;
    palettes[kind] = read;
  }
  const corrections: FactCorrection[] = [];
  for (const entry of input.corrections.slice(0, CORRECTIONS_MAX)) {
    const read = correction(entry);
    if (read === undefined) return undefined;
    corrections.push(read);
  }
  return {
    fact: "derived-theme",
    formId: input.formId,
    palettes,
    face: input.face,
    pageTint: input.pageTint,
    hasLogo: input.logoKey !== null,
    corrections,
    tintDropped: input.tintDropped.filter(isPaletteKind),
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
