/**
 * Locale-aware value formatting for the portal (ADR-27, issue #729).
 *
 * ADR-27 puts dates, numbers and currency through the platform `Intl` APIs for the same
 * reason it puts prose through a catalog: a second locale must be a configuration change,
 * not a rewrite. The admin has had `lib/i18n/format.ts` and `ADMIN_LOCALE` since that
 * decision landed. The portal had the machinery's other half and not this one: a catalog
 * (`en.ts`) whose header already says a second locale is a new catalog module, and one
 * formatted value that inlined `toLocaleString("en-US", ...)` inside
 * `components/completion-view.tsx`. So the respondent-facing app was the one where a second
 * locale meant editing a component, and its single date was tagged `en-US` while the
 * catalog beside it and the whole admin were `en`.
 *
 * This module is that swap point. It is deliberately small: it carries the cases the portal
 * actually renders and nothing else, because an unused formatter is a claim about behaviour
 * that no caller and no test exercises. It grows when a screen grows.
 *
 * ## Both inputs are explicit, because the portal renders twice
 *
 * **Determinism.** Every portal screen is server-rendered and then hydrated in the browser
 * (`components/hydration-marker.tsx` exists to signal exactly that). A formatter that
 * resolved its locale or its time zone from the ambient runtime would produce one string in
 * Node and another in the browser: a hydration mismatch, which the suite's console gate
 * fails a run on. So the locale is {@link PORTAL_LOCALE} and the zone is UTC, both named
 * here rather than read from the request, the `Accept-Language` header or the browser.
 *
 * **Truthfulness.** UTC is not a compromise on the receipt. The API stores an instant and
 * returns it as ISO-8601; the respondent may be anywhere; and the zone is rendered in the
 * output rather than assumed, so a submission time is a statement about one clock that
 * names which clock it is. This is the portal's analogue of the argument written out in
 * `apps/admin/lib/i18n/format.ts`, and the reason the two apps agree.
 *
 * There is deliberately no operator-zone twin here. The admin has one (issue #279) because
 * an operator acts on these values all day from a fixed desk; a respondent sees one
 * timestamp once, on a receipt they may screenshot and send to someone else in another
 * zone, and a self-relative "your own clock" reading would make that copy ambiguous.
 *
 * ## Why the shape differs from the admin's by one option
 *
 * {@link formatDateTime} asks for `hour: "numeric"` where the admin asks for `2-digit`.
 * That is not drift: it is what keeps the respondent's receipt byte-identical to the string
 * this module replaced. The retired call asked for `timeStyle: "short"`, which in `en` is a
 * bare hour, and the receipt has read `Aug 2, 2026, 4:36 AM UTC` since task 029. Issue #729
 * is about where the locale lives, not about what a respondent reads, so the only thing
 * that moved is the call site. `format.test.ts` pins the exact string.
 *
 * The zone name moved INTO the formatter at the same time. It used to be a literal ` UTC`
 * appended in JSX beside the formatted value, which is the same hand-cut-string problem one
 * level up: a locale that wrote its zone abbreviation elsewhere in the sentence, or not in
 * Latin script, had no way to say so. `Intl` knows where the zone goes; the output is
 * unchanged because in `en` it goes exactly where the literal was.
 *
 * A second locale swaps {@link PORTAL_LOCALE} alongside the catalog module and every
 * formatted value follows. That is Phase 4 work (R7, and issue #732 owns the switcher);
 * nothing here has to change for it.
 */

/**
 * The locale every formatter in the portal resolves against.
 *
 * One locale at launch (R7), named once, and the same tag the catalog and the admin use:
 * `en`, not `en-US`. The region subtag was never meaningful here - the portal has no
 * US-specific content - and for every value this app renders the two tags resolve to the
 * same CLDR data, which `format.test.ts` asserts rather than assumes.
 *
 * It is also what `components/step-flow.tsx` and `components/native-step.tsx` hand
 * `A2UIStepRenderer`, whose `locale` prop feeds react-aria's `I18nProvider` and therefore
 * the date field's segment order, its calendar and its announcements. Those call sites used
 * to pass nothing and inherit the package's own `en-US` default, which put the respondent's
 * form controls on a locale the portal never chose and could not change from here.
 *
 * It is deliberately not read from the request or the browser: see the determinism argument
 * in the module note above.
 */
export const PORTAL_LOCALE = "en";

/** The zone every timestamp is rendered in, named in the output so it is never assumed. */
const DISPLAY_TIME_ZONE = "UTC";

/**
 * A day and a time, with the zone named.
 *
 * No seconds: the receipt answers "when did this go in", not "in which second", and the
 * value a respondent quotes back is the content hash beside it. See the module note for why
 * `hour` is `numeric` rather than the admin's `2-digit`.
 */
const DAY_AND_TIME = new Intl.DateTimeFormat(PORTAL_LOCALE, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: DISPLAY_TIME_ZONE,
  timeZoneName: "short",
});

/**
 * Read an API timestamp, or `undefined` when there is nothing readable to render.
 *
 * `lib/server/route-helpers.ts` already validates the receipt cookie's `submittedAt` with
 * `z.iso.datetime()`, precisely so that a hand-set cookie cannot put the literal text
 * `Invalid Date` in front of a respondent. This is the second half of the same defence, so
 * the property holds for any caller rather than only for the one that happens to be guarded
 * upstream today.
 */
function instant(iso: string | null | undefined): Date | undefined {
  if (iso === null || iso === undefined || iso.trim() === "") return undefined;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * An instant as a respondent reads it: a date, a time, and the clock it is on.
 *
 * Anything unreadable renders as `fallback` rather than as `Invalid Date`. The default is
 * the empty string, so a caller that renders it into a definition list shows an empty value
 * instead of an alarming one on a page whose whole job is to say the submission worked.
 */
export function formatDateTime(iso: string | null | undefined, fallback = ""): string {
  const parsed = instant(iso);
  return parsed === undefined ? fallback : DAY_AND_TIME.format(parsed);
}
