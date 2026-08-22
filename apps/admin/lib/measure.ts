/**
 * THE MEASURE TABLE - which cap each authenticated screen's content column takes, and
 * where that column sits in the space it is given.
 *
 * WHERE THE NUMBERS COME FROM. The design for a screen is that screen's POC in
 * `plan/admin-shell-poc/`, so every row below names the POC it was read off and the
 * selector inside it that carries the cap. Issue 558 built this mechanism and sourced
 * its values from `plan/admin-ux-audit.md` §6, which was the correct authority then;
 * issue 657 re-sourced all sixteen from the drawings without touching the mechanism.
 *
 * THE POCs SPECIFY WIDTH IN TWO LAYERS AND THIS TABLE IS ONE. A POC caps an outer
 * `.main` and then, on some screens, caps the content inside it again - a 720px
 * `.editor-column` inside a 1600px `.main`, a 640px `.respondent-frame` inside another,
 * and a `deployment-ops-poc.html` whose `.main` has no cap at all and whose three
 * screens cap themselves at 900, 1180 and 1820. The number a reader of the running app
 * actually sees is the INNER one wherever there is one, so that is the number a route
 * takes here. Assigning the outer number instead would spread a 720px editor across
 * 1600px, which is not a screen any POC draws.
 *
 * WHY A TABLE, AND WHY HERE. Sixteen screens is a routing question, so it is answered
 * once, in route terms, in this file - not by sixteen pages each reaching up to override
 * a container they do not own. The practical difference is what happens when a
 * seventeenth screen arrives: with the table, its cap is one row added below, and
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
 * the cap the column is fluid, so every value renders identically at 390px and they
 * differ only once the viewport passes them. "Measurably wider at 1280 and above" and
 * "unchanged at 390" both fall out of the cap alone, with no media query at any width.
 * Spelling these as `sidebar:` variants would have turned the cap into a per-route use of
 * a boundary, which `plan/admin-design-contracts.md` §1 does not have and issue 557
 * exists to prevent.
 *
 * The numbers behind the names live in `app/globals.css` beside the breakpoint tokens,
 * with the derivation of each. This module names them, assigns them, and states the one
 * thing that is not a length: the alignment.
 */

/**
 * The class each answer puts on the shell's content column.
 *
 * Seven caps for sixteen screens, and the count is the POCs' rather than a taste: six
 * screens share the drawings' dominant 1600, four share 640, two share 1080, and the
 * remaining four are each the only screen drawn at their number. Collapsing the singletons
 * onto a neighbour would be this file deciding a width the drawing already decided.
 *
 * `default` is the odd member and is deliberately not a token. No route takes it since
 * issue 657 re-sourced the table; it is what `measureFor` falls back to for a pathname no
 * route claims, and Tailwind's own `max-w-5xl` is the right shape for that - a readable
 * measure for a screen nobody has drawn yet.
 */
export const MEASURE_CLASS = {
  default: "max-w-5xl",
  prose: "max-w-measure-prose",
  narrow: "max-w-measure-narrow",
  ops: "max-w-measure-ops",
  list: "max-w-measure-list",
  log: "max-w-measure-log",
  wide: "max-w-measure-wide",
  queue: "max-w-measure-queue",
} as const;

/** One of the caps a route can take. Each one is a number some POC draws. */
export type Measure = keyof typeof MEASURE_CLASS;

/**
 * Every authenticated route, with the cap its own POC gives that screen's content.
 *
 * Ordered the way the route tree reads, so the two can be compared by eye. Each comment
 * is the POC file and the selector the number was read from; where the POC's outer
 * `.main` differs from the inner cap that governs what is on screen, both are named, so a
 * reader can check the row against the drawing without opening this file's doc block.
 */
export const MEASURE_BY_ROUTE = {
  /** `library-lists-poc.html` `.main` 1080, its Forms screen. */
  "/forms": "list",
  /** `admin-shell-poc.html` `.main` 1600. The builder is what that file draws. */
  "/forms/[formId]": "wide",
  /** `links-webhooks-poc.html` `.main` 1600, its Secure links screen. */
  "/forms/[formId]/links": "wide",
  /**
   * `preview-versions-poc.html`: `.main` 1600, but the draft preview's own content is the
   * 640px `.respondent-frame` and two 640px banners beside it. 640 is the width a reader
   * sees, and it is also the correctness argument `plan/admin-ux-audit.md` §3.4 makes -
   * a respondent-facing render inside a wider container makes the preview lie.
   */
  "/forms/[formId]/preview": "prose",
  /** `responses-poc.html` `.main` 1600, its list screen; nothing inside caps narrower. */
  "/forms/[formId]/responses": "wide",
  /** `responses-poc.html` `.main` 1600, its detail screen; same, nothing narrower inside. */
  "/forms/[formId]/responses/[sessionId]": "wide",
  /** `preview-versions-poc.html` `.main` 1600, its version-history table. */
  "/forms/[formId]/versions": "wide",
  /** `preview-versions-poc.html` again: the stored render is the same 640px frame. */
  "/forms/[formId]/versions/[version]": "prose",
  /** `links-webhooks-poc.html` `.main` 1600, its Webhook endpoints screen. */
  "/forms/[formId]/webhooks": "wide",
  /** `library-lists-poc.html` `.main` 1080, its Questions screen. */
  "/questions": "list",
  /**
   * `question-editor-poc.html`: `.main` 1600 with a single child, `.editor-column` 720.
   * The editor is that column, so 720 is the screen.
   */
  "/questions/[questionId]": "narrow",
  /** `settings-newquestion-poc.html` `.page-main` 40rem, its New question screen. */
  "/questions/new": "prose",
  /** `deployment-ops-poc.html` `.ops-inner--responses` 900; that file's `.main` has no cap. */
  "/responses": "ops",
  /** `deployment-ops-poc.html` `.ops-inner--erasures` 1180. */
  "/responses/erasures": "log",
  /** `settings-newquestion-poc.html` `.page-main` 40rem, its Account screen (issue 655). */
  "/settings": "prose",
  /** `deployment-ops-poc.html` `.ops-inner--webhooks` 1820, the widest screen drawn. */
  "/webhooks": "queue",
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
 * against a dynamic sibling. Here that distinction now decides two different caps rather
 * than agreeing by accident: the new-question form is 40rem and the editor is 720px.
 *
 * An unknown path takes the readable measure: a route with no POC behind it is not a
 * route that should be handed extra width by default.
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
 * THERE IS NO ALIGNMENT BRANCH HERE, and its absence is the statement. Issue 655 left a
 * one-member set of left-anchored caps behind, with a note that issue 648 would either
 * make it the mechanism or make it redundant; reading the POCs made it redundant. All
 * eleven were checked for a centring rule on the main column and there is not one in the
 * set, and `settings-newquestion-poc.html` is explicit about why it writes `margin: 0`
 * where `margin: 0 auto` would go: a screen floating to the middle while every other
 * screen hugs the left edge "reads as a different app, not a lighter one". So every route
 * gets the same shape and `mx-auto` is simply never emitted.
 *
 * Composed here rather than at the call site because the cap and the alignment are one
 * answer per route: a column capped at 40rem and then centred is not the screen any POC
 * draws, and a caller free to add `mx-auto` back is a caller free to reintroduce exactly
 * the bug issue 648 reported.
 */
export function mainClassFor(pathname: string): string {
  return `w-full ${MEASURE_CLASS[measureFor(pathname)]} flex-1 p-6`;
}
