/**
 * THE MEASURE TABLE - which cap each authenticated screen's content column takes, and
 * where that column sits in the space it is given.
 *
 * WHERE THE NUMBERS COME FROM. The design for a screen is that screen's POC in
 * `plan/admin-shell-poc/`, so every row below names the POC it was read off and the
 * selector inside it that carries the cap. Issue 558 built this mechanism and sourced
 * its values from `plan/admin-ux-audit.md` §6, which was the correct authority then;
 * issue 657 re-sourced all sixteen from the drawings without touching the mechanism, and
 * issue 685 added the seventeenth by exactly the one-line route this table promises, and
 * issue #669 the eighteenth the same way.
 *
 * THE POCs SPECIFY WIDTH IN TWO LAYERS AND THIS TABLE IS THE OUTER ONE. A POC caps an
 * outer `.main` and then, on some screens, caps the content inside it again - a 720px
 * `.editor-column` inside a 1600px `.main`, a 640px `.respondent-frame` inside another,
 * and a `deployment-ops-poc.html` whose `.main` has no cap at all (`:229`) and whose three
 * screens cap themselves at 900, 1180 and 1820.
 *
 * Issue 657 collapsed both layers into this one table, giving each route the number a
 * reader actually sees, which is the inner one wherever there is one. That was right about
 * what is on screen and wrong by the column's own padding: a cap here sits on a `<main>`
 * that pads itself, while the drawn element sits INSIDE its POC's `.main` padding. Issue
 * 668 built the missing layer instead - `.qcms-editor-column` and `.qcms-respondent-frame`
 * in `app/globals.css` - so the three screens that draw an inner element now take their
 * POC's OUTER number here, and the element carries the inner one itself, at the size it is
 * drawn rather than at that size minus two paddings.
 *
 * WHERE A POC'S OUTER LAYER IS "NONE", THIS TABLE STILL CARRIES THE INNER NUMBER.
 * `deployment-ops-poc.html` caps nothing outer, so `/responses` and `/responses/erasures`
 * have no outer number to take and keep the per-screen cap 657 gave them. That is also why
 * issue 668's own closing list names three screens rather than six.
 *
 * READING A MULTI-SCREEN POC, which is where that rule earns its keep. Six of the eleven
 * files pack two or three screens behind a switcher, and a shared `.main` in such a file
 * is ambiguous by construction: it may be that file's chrome or it may be every screen's
 * answer, and the markup alone cannot say which. **The inner class is what disambiguates
 * it.** Where the author wanted a per-screen width they wrote one - three of them in
 * `deployment-ops-poc.html`, one in `preview-versions-poc.html` used by two of its three
 * screens - and where they did not, the shared `.main` stands for every screen in the
 * file, which is how the version-history screen takes 1600 from a file two of whose
 * screens do not. That rule is the whole of the reading; it is not a preference for inner
 * numbers, and it does not make a shared cap meaningless.
 *
 * ONE ROW IS OPEN. `/webhooks` is drawn at 1820, wider than any token here, so it keeps
 * the cap it had. See its comment.
 *
 * WHY A TABLE, AND WHY HERE. Eighteen screens is a routing question, so it is answered
 * once, in route terms, in this file - not by eighteen pages each reaching up to override
 * a container they do not own. The practical difference is what happens when a
 * new screen arrives: with the table, its cap is one row added below, and
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
 * Five caps for eighteen screens, and the count is the POCs' rather than a taste: eleven
 * screens share the drawings' dominant 1600, three share 40rem, two share 1080, and two
 * are each the only screen drawn at their number. Collapsing a singleton onto a neighbour
 * would be this file deciding a width the drawing already decided.
 *
 * IT WAS SIX UNTIL ISSUE 668, and `narrow` (45rem) is the one that left. It existed to
 * serve the three screens whose POC draws an inner element, at neither drawn number: 45rem
 * rendered a 42rem column, 48px under the drawn 720 editor and 32px over the drawn 640
 * frame, and was the closest one-layer answer to both. Building the second layer removed
 * the compromise rather than retuning it, so those three routes take their POC's outer
 * 1600 here and nothing takes 45rem. The TOKEN survives in `app/globals.css` because
 * `components/save-model.tsx` caps its tooltip with it; the route vocabulary does not
 * keep a member no route can take.
 *
 * `default` is the odd member and is deliberately not a token. No route takes it since
 * issue 657 re-sourced the table; it is what `measureFor` falls back to for a pathname no
 * route claims, and Tailwind's own `max-w-5xl` is the right shape for that - a readable
 * measure for a screen nobody has drawn yet.
 */
export const MEASURE_CLASS = {
  default: "max-w-5xl",
  prose: "max-w-measure-prose",
  ops: "max-w-measure-ops",
  list: "max-w-measure-list",
  log: "max-w-measure-log",
  wide: "max-w-measure-wide",
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
  /**
   * `settings-newquestion-poc.html` `.page-main` 40rem, through its New question screen.
   *
   * The one row whose drawing is reached by a step rather than read straight off a file,
   * and the step is itself a POC's ruling. `library-lists-poc.html` picks a separate
   * creation route for BOTH library screens and names `/questions/new` as the model the
   * forms list should be brought into line with (issue 685); `/questions/new` is drawn in
   * `settings-newquestion-poc.html` at 40rem. Taking any other number here would make the
   * two creating screens two widths, which is the second answer that ruling exists to
   * prevent.
   */
  "/forms/new": "prose",
  /** `admin-shell-poc.html` `.main` 1600. The builder is what that file draws. */
  "/forms/[formId]": "wide",
  /**
   * `rules-screen-poc.html` `.main` 1600, and that file draws nothing narrower inside it.
   *
   * The eighteenth row (issue #669), and the second reached because a ruling moved a screen
   * rather than because someone drew a new one: the rules were a selection on the builder
   * until 2026-09-05, and this file has always had a POC of its own. 1600 is also what the
   * screen was already getting, since it was rendering inside the builder's column - so
   * this row keeps the width an author has, which is the honest outcome when a screen moves
   * house. It is the widest thing the app builds and the drawing agrees: a condition tree
   * beside its JSON mirror, with a full-width target list under both.
   */
  "/forms/[formId]/rules": "wide",
  /** `links-webhooks-poc.html` `.main` 1600, its Secure links screen. */
  "/forms/[formId]/links": "wide",
  /**
   * `preview-versions-poc.html` `.main` 1600, with the screen's own content in the 640px
   * `.respondent-frame` inside it (`:446`, `:626`) and two 640px banners beside it.
   *
   * THE 640 IS NOT HERE, AND THAT IS THE POINT OF ISSUE 668. It is a drawn ELEMENT rather
   * than a width - a bordered, rounded, shadowed inset with a "Respondent view" bar above
   * it, whose own comment says the 640 is chosen so the frame reads "as a device-like
   * inset rather than as 'the page just got narrower here'". Carried here as a cap on
   * `<main>` it was the second of those and rendered 592 rather than 640, because the cap
   * sat outside a padding the drawn frame sits inside. It is now `.qcms-respondent-frame`
   * on the element the app already had for it (`components/preview-theme-island.tsx`), so
   * this row is the outer number and the frame is the inner one, at 640 exactly.
   *
   * `plan/admin-ux-audit.md` §3.4's correctness argument is unaffected and is now carried
   * by the frame: a respondent-facing render is never given a container wider than a
   * respondent's. `<main>` around it is author-only chrome, which is what the POC's own
   * markup says of everything outside the frame.
   */
  "/forms/[formId]/preview": "wide",
  /** `responses-poc.html` `.main` 1600, its list screen; nothing inside caps narrower. */
  "/forms/[formId]/responses": "wide",
  /** `responses-poc.html` `.main` 1600, its detail screen; same, nothing narrower inside. */
  "/forms/[formId]/responses/[sessionId]": "wide",
  /** `preview-versions-poc.html` `.main` 1600, its version-history table. */
  "/forms/[formId]/versions": "wide",
  /**
   * `preview-versions-poc.html` again, `.main` 1600: the stored render is the same 640px
   * frame, shared unmodified (`:829`, and the POC says so in as many words). Same
   * arrangement as the draft preview above and for the same reason - one measure on both
   * screens is what lets an author judge either against the other.
   */
  "/forms/[formId]/versions/[version]": "wide",
  /** `links-webhooks-poc.html` `.main` 1600, its Webhook endpoints screen. */
  "/forms/[formId]/webhooks": "wide",
  /** `library-lists-poc.html` `.main` 1080, its Questions screen. */
  "/questions": "list",
  /**
   * `question-editor-poc.html` `.main` 1600 (`:312`) with a single child,
   * `.editor-column` 720 (`:313`).
   *
   * The 720 is the page's own now (`.qcms-editor-column` on the column this screen
   * already renders), not a cap on `<main>`: carried here it rendered 672 against a drawn
   * 720, for the same reason the frame rendered 592 against a drawn 640. The POC's own
   * comment is why the outer 1600 matters as well as the inner 720 - "this screen is
   * prose-and-form shaped, so the improvement here is a comfortable reading measure, not
   * more width" - and a screen says that by being a narrow column inside a wide one.
   */
  "/questions/[questionId]": "wide",
  /** `settings-newquestion-poc.html` `.page-main` 40rem, its New question screen. */
  "/questions/new": "prose",
  /**
   * `deployment-ops-poc.html` `.ops-inner--responses` 900. That file's `.main` carries no
   * cap at all (`:229`), so its three screens are pure per-screen statements: where the
   * author wanted a per-screen width they wrote an inner class for it.
   */
  "/responses": "ops",
  /** `deployment-ops-poc.html` `.ops-inner--erasures` 1180. */
  "/responses/erasures": "log",
  /** `settings-newquestion-poc.html` `.page-main` 40rem, its Account screen (issue 655). */
  "/settings": "prose",
  /**
   * UNRESOLVED, and left where it was rather than guessed. `deployment-ops-poc.html`'s
   * `.ops-inner--webhooks` is 1820px, which is wider than `wide` and so cannot be
   * expressed by reassignment: it needs an eighth value in the vocabulary, which is a
   * change to the scheme rather than a row in this table. Issue 657 names it as the one
   * route whose cap does not match its drawing.
   */
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
 *
 * THE PADDING IS THE POC'S TOKEN AND NOT A TAILWIND STEP (issue 675). Every POC declares
 * `--admin-section-pad: 1.25rem` and spends it on `.main` and on `.topbar__inner` alike,
 * and that ONE value is how the drawings get their shared left edge. This column carried
 * `p-6` from the day the shell was built and issue 648 matched the bar to it rather than
 * to the drawing, which put both 4px out. Spelling it as the token here and in
 * `app/(shell)/layout.tsx` is what stops the bar and the column drifting apart again: the
 * two call sites cannot disagree because there is nothing left for them to disagree about.
 */
export function mainClassFor(pathname: string): string {
  return `w-full ${MEASURE_CLASS[measureFor(pathname)]} flex-1 p-(--admin-section-pad)`;
}
