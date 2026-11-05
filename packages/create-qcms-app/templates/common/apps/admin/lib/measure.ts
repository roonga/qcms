/** This table owns outer route caps; inner editor columns and respondent frames own their separate widths. Where a drawing has no outer cap, use its per-screen cap. Route-tree tests require complete coverage. */

/** Default is a fallback for unknown paths, not a route token. Keep drawn outer and inner widths separate instead of approximating both with one cap. */
export const MEASURE_CLASS = {
  default: "max-w-5xl",
  prose: "max-w-measure-prose",
  ops: "max-w-measure-ops",
  list: "max-w-measure-list",
  log: "max-w-measure-log",
  wide: "max-w-measure-wide",
} as const;

export type Measure = keyof typeof MEASURE_CLASS;

export const MEASURE_BY_ROUTE = {
  "/forms": "list",
  /** Use the same 40rem creation-screen cap as New question; creation routes share that design. */
  "/forms/new": "prose",

  "/forms/[formId]": "wide",
  /** rules-screen-poc.html .main is 1600 with no narrower inner content. */
  "/forms/[formId]/rules": "wide",

  "/operations/forms/[formId]/links": "wide",
  /** Use the outer 1600 cap here; the respondent frame owns its 640 width inside padding so author chrome cannot change respondent layout. */
  "/forms/[formId]/preview": "wide",

  "/operations/forms/[formId]/responses": "wide",

  "/operations/forms/[formId]/responses/[sessionId]": "wide",

  "/forms/[formId]/versions": "wide",
  /** Match the adjacent version-history width so reviewing and publishing do not reflow the same rows. */
  "/forms/[formId]/publish": "wide",
  /** Stored and draft previews share the same respondent frame inside the outer cap. */
  "/forms/[formId]/versions/[version]": "wide",

  "/operations/forms/[formId]/webhooks": "wide",
  /** No POC draws Intake: one panel of state, so it takes `/me/access`' prose cap. */
  "/operations/forms/[formId]/intake": "prose",
  /** No POC draws the known-target erasure: one field and one act, so it takes the same prose cap. */
  "/operations/forms/[formId]/erase": "prose",

  "/questions": "list",
  /** question-editor-poc.html draws outer 1600 and inner editor-column 720; the inner element owns its own width. */
  "/questions/[questionId]": "wide",

  "/questions/new": "prose",

  "/me/access": "prose",
  "/operations": "list",
  "/responses": "list",

  "/responses/erasures": "log",

  "/settings": "prose",
  /** The webhook drawing is 1820, beyond this vocabulary. Keep the current cap until the width scheme can represent that value. */
  "/webhooks": "wide",
  /** No dedicated membership drawings exist; choose caps by the analogous list and detail surfaces until those designs are supplied. */
  "/workspaces": "ops",
  "/workspaces/[workspaceId]": "log",
} as const satisfies Record<string, Measure>;

function segmentsOf(value: string): string[] {
  return value.split("/").filter((segment) => segment !== "");
}

function patternMatches(pattern: readonly string[], path: readonly string[]): boolean {
  if (pattern.length !== path.length) return false;
  return pattern.every((segment, index) => segment.startsWith("[") || segment === path[index]);
}

/** Prefer the most literal route pattern so /questions/new does not inherit the dynamic detail cap. */
export function measureFor(pathname: string): Measure {
  const path = segmentsOf(pathname);
  let best: { literals: number; measure: Measure } | undefined;
  for (const [route, measure] of Object.entries(MEASURE_BY_ROUTE)) {
    const pattern = segmentsOf(route);
    if (!patternMatches(pattern, path)) continue;
    const literals = pattern.filter((segment) => !segment.startsWith("[")).length;
    if (best === undefined || literals > best.literals) best = { literals, measure };
  }
  return best?.measure ?? "default";
}

export function measureClassFor(pathname: string): string {
  return MEASURE_CLASS[measureFor(pathname)];
}

/** Keep content start-aligned with the topbar; emitting mx-auto would separate their leading edges. */
export function mainClassFor(pathname: string): string {
  return `w-full ${MEASURE_CLASS[measureFor(pathname)]} flex-1 p-(--admin-section-pad)`;
}
