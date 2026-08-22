/**
 * THE MEASURE TABLE - which cap each authenticated screen's content column takes.
 *
 * `plan/admin-ux-audit.md` §6 asks the width question screen by screen and comes back
 * with three answers across sixteen screens: five earn width, two need LESS than the app
 * default because they render respondent-facing content (§3.4, §5.3), and nine keep the
 * readable measure they already have. Before issue 558 the shell answered all sixteen
 * with one number, `max-w-5xl` on `<main>`, and §6 is explicit that a single global raise
 * "would be wrong for eleven of the sixteen".
 *
 * A FOURTH ANSWER JOINED THE THREE IN ISSUE 655, and it is the reason this table now
 * decides an alignment as well as a cap. Settings is drawn by its own POC
 * (`plan/admin-shell-poc/settings-newquestion-poc.html`), which caps that screen at 40rem
 * and left-anchors it, and one screen differing from the other fifteen on both counts is
 * exactly the kind of question this file exists to answer once, in route terms.
 *
 * WHY A TABLE, AND WHY HERE. Sixteen screens with three answers is a routing question, so
 * it is answered once, in route terms, in this file - not by sixteen pages each reaching
 * up to override a container they do not own. The practical difference is what happens
 * when a seventeenth screen arrives: with the table, its cap is one row added below, and
 * `measure.test.ts` fails until that row exists, because it reads the route patterns off
 * the `app/(shell)` tree and requires these keys to be exactly that set. A scattered
 * per-page override has no such moment - a new screen simply inherits whatever the
 * container happened to be, and nobody is ever asked the question.
 *
 * WHY THE KEYS ARE NEXT ROUTE PATTERNS rather than live paths. `/forms/frm_x/versions`
 * and `/forms/frm_y/versions` are one screen and must not be two rows, so the table is
 * keyed the way the filesystem is (`[formId]`, `[version]`) and `measureFor` fills the
 * dynamic segments from the pathname it is given. That also makes the table diff-readable
 * against the route tree, which is what its completeness test compares it to.
 *
 * NO BREAKPOINT IS INVOLVED. A `max-inline-size` is already a responsive condition: below
 * the cap the column is fluid, so all three values render identically at 390px and differ
 * only once the viewport passes them. "Measurably wider at 1280 and above" and "unchanged
 * at 390" both fall out of the cap alone, with no media query at any width. Spelling these
 * as `sidebar:` variants would have turned the cap into a per-route use of a boundary,
 * which `plan/admin-design-contracts.md` §1 does not have and issue 557 exists to prevent.
 *
 * The numbers behind the three names live in `app/globals.css` beside the breakpoint
 * tokens, with the derivation of each. This module names them and nothing else.
 */

/**
 * The class each answer puts on the shell's content column.
 *
 * `default` is deliberately still Tailwind's own `max-w-5xl` rather than a fourth token of
 * the same value: nine screens have to render byte-identically after issue 558, and the
 * cheapest way to be certain is for their `<main>` to keep the exact class attribute it
 * carried before. `measure.test.ts` pins that string for the same reason.
 */
export const MEASURE_CLASS = {
  default: "max-w-5xl",
  wide: "max-w-measure-wide",
  narrow: "max-w-measure-narrow",
  prose: "max-w-measure-prose",
} as const;

/** One of the answers a route can take: §6's three, plus the POC's prose cap (issue 655). */
export type Measure = keyof typeof MEASURE_CLASS;

/**
 * The answers whose column is LEFT-ANCHORED instead of centred in the shell.
 *
 * `plan/admin-shell-poc/settings-newquestion-poc.html` writes `margin: 0` on its main column
 * and says why: every rail-adjacent screen in the design follows "left-anchored, fluid up to
 * a cap, never re-centred", and a screen with a narrower column floating to the middle while
 * every other screen hugs the left edge "reads as a different app, not a lighter one".
 *
 * ONE ANSWER IS IN THIS SET, DELIBERATELY. Issue 648 carries left-anchoring for the app as a
 * whole; issue 655 carries the 40rem prose cap for the Settings screen, and this is the least
 * that cap needs to be what the POC draws. Whichever of the two lands second inherits the
 * other, and if that is 648 then this set stops being a set: `mx-auto` leaves the shell
 * entirely and these two lines go with it.
 */
const LEFT_ANCHORED: ReadonlySet<Measure> = new Set<Measure>(["prose"]);

/**
 * Every authenticated route, with the cap §6 assigns it.
 *
 * Ordered the way the route tree reads, so the two can be compared by eye. The reason
 * beside each non-default row is §6's, compressed; the full argument is in the audit.
 *
 * The three "borderline, take width if it is free" screens of §6 (`/forms/[formId]/
 * responses`, `/responses/erasures`, `/forms/[formId]/responses/[sessionId]`) stay on the
 * default. Width is not free for them: §6's own summary counts nine screens staying, and
 * these are three of the nine. Their columns fit the readable measure today, and the
 * `qcms-ops-summary` label track that would benefit from more room is a grid question
 * rather than a container one.
 */
export const MEASURE_BY_ROUTE = {
  "/forms": "default",
  /** The builder: the app's only three responsive utilities, already fighting the cap. */
  "/forms/[formId]": "wide",
  /** Seven columns, four of them timestamps. */
  "/forms/[formId]/links": "wide",
  /** Respondent-facing render. A wider container here makes the preview lie (§3.4). */
  "/forms/[formId]/preview": "narrow",
  "/forms/[formId]/responses": "default",
  "/forms/[formId]/responses/[sessionId]": "default",
  /** Five monospace stamp columns. */
  "/forms/[formId]/versions": "wide",
  /** Respondent-facing render, same correctness argument as the preview (§3.4). */
  "/forms/[formId]/versions/[version]": "narrow",
  /** Two wide tables stacked, one of them seven columns with a URL and nowrap cells. */
  "/forms/[formId]/webhooks": "wide",
  "/questions": "default",
  "/questions/[questionId]": "default",
  "/questions/new": "default",
  "/responses": "default",
  "/responses/erasures": "default",
  /** Prose and two short forms. The POC caps it at 40rem and does not centre it. */
  "/settings": "prose",
  /** Six columns including a URL and a free-text `lastError`. */
  "/webhooks": "wide",
} as const satisfies Record<string, Measure>;

/** A pathname or route pattern split into its segments, with empties dropped. */
function segmentsOf(value: string): string[] {
  return value.split("/").filter((segment) => segment !== "");
}

/** A `[formId]`-style segment matches any one segment; anything else matches itself. */
function patternMatches(pattern: readonly string[], path: readonly string[]): boolean {
  if (pattern.length !== path.length) return false;
  return pattern.every((segment, index) => segment.startsWith("[") || segment === path[index]);
}

/**
 * The cap for a live pathname.
 *
 * Where two patterns match - `/questions/new` is also a `/questions/[questionId]` - the
 * one with more literal segments wins, which is how Next itself resolves a static segment
 * against a dynamic sibling. An unknown path takes the readable measure: a route that has
 * not been through §6 is not a route that should be handed extra width by default.
 */
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

/** The cap for a live pathname, as the utility class the shell puts on its column. */
export function measureClassFor(pathname: string): string {
  return MEASURE_CLASS[measureFor(pathname)];
}

/**
 * The whole class attribute the shell's content column carries for a pathname.
 *
 * Composed here rather than at the call site because the cap and the alignment are one
 * answer: a column capped at 40rem and then centred is not the screen the POC draws. The
 * fifteen screens that are not Settings get back the exact string `<main>` has carried since
 * issue 558 - `mx-auto w-full <cap> flex-1 p-6` - character for character, which is the
 * strongest available form of "nothing else moved".
 */
export function mainClassFor(pathname: string): string {
  const measure = measureFor(pathname);
  const alignment = LEFT_ANCHORED.has(measure) ? "" : "mx-auto ";
  return `${alignment}w-full ${MEASURE_CLASS[measure]} flex-1 p-6`;
}
