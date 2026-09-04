import type { FormDetail } from "./types.ts";

/**
 * The form's own standing address on the respondent portal, or `undefined` when it has
 * none to show (`plan/admin-shell-poc/responses-poc.html`, which draws this block).
 *
 * ## What this is, and what it is not
 *
 * `${portalBaseUrl}/f/${slug}` is the portal's anonymous entry route
 * (`apps/portal/app/f/[formSlug]/page.tsx`), and it is the form's address for as long as
 * the form stays published: it never expires and it is never consumed. A **secure link**
 * on the Links screen is the other thing entirely - a one-time or expiring invitation the
 * API mints and cannot show a second time - and the POC's own note is emphatic that the
 * two must not be confused for each other. Hence a different label, a different screen and
 * this separate helper rather than a branch inside the links code.
 *
 * ## Why a published version is the condition
 *
 * A form with no published version has nothing behind that URL: the portal's start route
 * answers `notfound` and the respondent gets "this form is unavailable". Offering an
 * address that does not work yet is worse than offering none, so a draft-only form gets
 * `undefined` and the screen shows nothing rather than a link with a caveat.
 *
 * A CLOSED form still gets its link, and that is deliberate rather than an oversight. The
 * address is live and correct - the portal answers it with "this form is closed" - and an
 * operator confirming what respondents were sent needs to see the same string they have.
 * The copy beside it says which of the two states the form is in.
 *
 * ## Why the base URL can be absent
 *
 * `QCMS_PORTAL_BASE_URL` is required of the API, which mints secure links with it, but the
 * admin has only just started reading it. A deployment that has not set it for this service
 * gets no block rather than a broken URL, which is the same shape `lib/server/config.ts`
 * uses for every optional read: absent is a state, not an error.
 */
export function publicFormLink(
  detail: Pick<FormDetail, "slug" | "versions">,
  portalBaseUrl: string | undefined,
): string | undefined {
  if (portalBaseUrl === undefined || portalBaseUrl.trim() === "") return undefined;
  if (detail.versions.length === 0) return undefined;
  try {
    return new URL(`/f/${encodeURIComponent(detail.slug)}`, portalBaseUrl).toString();
  } catch {
    // An unparseable base is a misconfiguration, and this is a view: it renders nothing
    // rather than throwing a screen away over a variable an operator can fix.
    return undefined;
  }
}
