import { t, type MessageKey } from "../i18n/en.ts";

/** One pair of 107's contrast check that fell short, as the API reports it on APPEARANCE_CONTRAST. */
export interface ContrastFailureView {
  readonly palette: string;
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
  readonly required: number;
}

const MODE_LABELS: Readonly<Record<string, MessageKey>> = {
  light: "appearance.mode.light",
  dark: "appearance.mode.dark",
  lightHighContrast: "appearance.mode.lightHighContrast",
  darkHighContrast: "appearance.mode.darkHighContrast",
};

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Reads only the named fields, so an unexpected envelope reports nothing rather than raw prose. */
export function parseContrastFailures(detail: unknown): readonly ContrastFailureView[] {
  const failures = (detail as { failures?: unknown } | undefined)?.failures;
  if (!Array.isArray(failures)) return [];
  return failures.flatMap((entry): ContrastFailureView[] => {
    const row = entry as Record<string, unknown>;
    const palette = str(row["palette"]);
    const foreground = str(row["foreground"]);
    const background = str(row["background"]);
    const ratio = num(row["ratio"]);
    const required = num(row["required"]);
    if (
      palette === undefined ||
      foreground === undefined ||
      background === undefined ||
      ratio === undefined ||
      required === undefined
    ) {
      return [];
    }
    return [{ palette, foreground, background, ratio, required }];
  });
}

function ratioText(value: number): string {
  return value.toFixed(1);
}

/** One line of the correction report: which pair, in which mode, and how far short it fell. */
export function contrastFailureSentence(failure: ContrastFailureView): string {
  const key = MODE_LABELS[failure.palette];
  return t("appearance.contrastFailure", {
    foreground: failure.foreground,
    background: failure.background,
    mode: key === undefined ? failure.palette : t(key),
    ratio: ratioText(failure.ratio),
    required: ratioText(failure.required),
  });
}
