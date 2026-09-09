import { RETURN_FIELD, appearanceCookiesFor } from "@/lib/appearance";
import {
  DEFAULT_RETURN,
  parseAppearanceChoice,
  safeReturnPath,
} from "@/lib/server/appearance-form";
import { portalBaseUrl, secureCookies } from "@/lib/server/config";
import { isSameOriginPost } from "@/lib/server/route-helpers";
import { portalFontChoices } from "@/lib/server/theme";

/**
 * The no-JS appearance form's target (issue #195): a native `<form method="post">`
 * carrying colour mode, font and density, answered with the same long-lived cookies
 * the header's scripted controls write, then a 303 back to the page it came from so
 * the server render honours the choice.
 *
 * ## Why a route at all
 *
 * Task 053 shipped the controls as a deliberate JavaScript-only enhancement and
 * `app/layout.tsx` hid the whole disclosure without scripting, because a radio a
 * respondent can move that changes nothing reads as a broken page. The cost was that
 * a no-JS respondent's appearance chain was cookie-then-config with **no way to set
 * the cookie**, and the two controls with the strongest accessibility claim - High
 * contrast, and the Atkinson Hyperlegible / Lexend / OpenDyslexic faces - are exactly
 * the ones a respondent with scripting disabled or restricted may most need. The
 * portal already commits to a working no-JS core flow (task 044), and this is the
 * same seam and the same progressive-enhancement discipline applied to the chrome:
 * the form is always in the markup, only its submit button is `<noscript>`-revealed,
 * and the scripted controls keep their no-reload behaviour untouched.
 *
 * ## Strict BFF (R2)
 *
 * No API call, no rule evaluation, no business logic: this handler validates two
 * respondent-supplied strings and writes presentation cookies. Both validations live
 * in `lib/server/appearance-form.ts` as pure functions, so what is left here is the
 * request/response shell.
 *
 * ## The redirect target is attacker-controllable, and is treated that way, twice
 *
 * `returnTo` arrives in the request body, so it is respondent input in the same sense a
 * form answer is. {@link safeReturnPath} is the first control: it resolves the candidate
 * against a synthetic origin and refuses anything that lands outside it, refuses a
 * backslash or an encoded separator, and refuses a pathname that is protocol-relative
 * AFTER normalisation - which is the case PR #859's review found, where `/..//evil.example`
 * parses to the pathname `//evil.example` and a single leading slash goes in while a
 * protocol-relative reference comes out.
 *
 * The second control is here, and it is what makes that class of defect unreachable rather
 * than merely fixed: the `Location` is built as an ABSOLUTE URL on this portal's own
 * configured base, so whatever path reaches {@link seeOther}, the header names this
 * deployment. Emitting the validated path relatively was the mistake that made the first
 * control load-bearing on its own.
 *
 * A belt-refused request gets `/`, never the target it supplied: a request that could not
 * prove it came from this origin has no say in where the browser goes next.
 *
 * ## Why a cookie is still worth a CSRF belt
 *
 * SEC-9's belt guards every state-changing route handler in the app, and
 * `scripts/check-origin-guards.test.ts` derives that set from disk rather than from a
 * list, so this route carries it the day it lands. The stake is genuinely small - the
 * worst a forged POST achieves is changing a respondent's own font - but "small" is a
 * judgement that would have to be re-made every time someone reads this file, and the
 * belt costs one call. The belt runs FIRST and nothing below it reads the request: a
 * refused request is sent to the site root with no cookie written (see
 * `beltOutcome: "redirect-to-root"` in `lib/server/origin-belt-log.ts`).
 */

/** A 303 to a validated same-origin path, optionally writing the appearance cookies. */
function seeOther(path: string, setCookies: readonly string[] = []): Response {
  const headers = new Headers({ Location: absoluteOnThisPortal(path) });
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/**
 * The path as an absolute URL on this portal's CONFIGURED base.
 *
 * Configured rather than `request.url`, which carries an attacker-chosen `Host` on a
 * forged request; the belt already compares `Origin` against the same configured value,
 * so this reuses the deployment's own statement of where it lives rather than inventing
 * a second source of truth.
 *
 * When the base cannot be read the path is emitted as-is, which is still safe: every
 * path reaching here has been through {@link safeReturnPath}, which refuses a pathname
 * that is protocol-relative after normalisation, so a relative `Location` can only
 * resolve against the origin the browser already had.
 */
function absoluteOnThisPortal(path: string): string {
  const base = configuredBaseUrl();
  if (base === undefined) return path;
  try {
    return new URL(path, base).toString();
  } catch {
    return path;
  }
}

/** The submitted fields, or an empty set when the body is not a readable form. */
async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    return new FormData();
  }
}

/** This portal's configured base URL, or `undefined` when it cannot be read. */
function configuredBaseUrl(): string | undefined {
  try {
    return portalBaseUrl();
  } catch {
    return undefined;
  }
}

export async function POST(request: Request): Promise<Response> {
  // The belt first, and a refusal reads nothing the request carried. An earlier version
  // parsed the body on the refusal path so a refused respondent could land back on their
  // own page; PR #859's review was right that a request which cannot prove its origin
  // should not choose the redirect either. The cost is that the small population of
  // browsers sending no Fetch Metadata is dropped at the site root rather than left where
  // they were, which `docs/operations.md` records as the symptom to expect.
  if (!isSameOriginPost(request)) return seeOther(DEFAULT_RETURN);

  const form = await readForm(request);
  const target = safeReturnPath(
    formField(form, RETURN_FIELD),
    request.headers.get("referer") ?? undefined,
    configuredBaseUrl(),
  );
  const offered = portalFontChoices().map((entry) => entry.key);
  const choice = parseAppearanceChoice(form, offered);
  return seeOther(target, appearanceCookiesFor(choice, secureCookies()));
}

/** One form field as a string, or `undefined` for an absent field or an upload. */
function formField(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}
