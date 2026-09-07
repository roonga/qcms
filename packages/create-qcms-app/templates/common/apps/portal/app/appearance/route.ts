import { RETURN_FIELD, appearanceCookiesFor } from "@/lib/appearance";
import { parseAppearanceChoice, safeReturnPath } from "@/lib/server/appearance-form";
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
 * ## The redirect target is attacker-controllable, and is treated that way
 *
 * `returnTo` arrives in the request body, so it is respondent input in the same sense
 * a form answer is. {@link safeReturnPath} resolves it against a synthetic origin and
 * refuses anything that lands outside it, which rejects `//evil.example`, its
 * backslash spelling, an absolute URL and a `javascript:` string alike; the fallbacks
 * are the `Referer` when it names this portal's own origin, then `/`. The `Location`
 * this handler emits is therefore always a path, never a value copied from the
 * request, and it is emitted **relative** so it can only ever resolve against the
 * origin the browser already had.
 *
 * ## Why a cookie is still worth a CSRF belt
 *
 * SEC-9's belt guards every state-changing route handler in the app, and
 * `scripts/check-origin-guards.test.ts` derives that set from disk rather than from a
 * list, so this route carries it the day it lands. The stake is genuinely small - the
 * worst a forged POST achieves is changing a respondent's own font - but "small" is a
 * judgement that would have to be re-made every time someone reads this file, and the
 * belt costs one call. The belt runs FIRST and its answer gates the cookies: a refused
 * request still gets its page back (see `beltOutcome: "redirect-to-page"` in
 * `lib/server/origin-belt-log.ts`), with its appearance unchanged.
 */

/** A 303 to a validated same-origin path, optionally writing the appearance cookies. */
function seeOther(path: string, setCookies: readonly string[] = []): Response {
  // A relative `Location`, which RFC 7231 allows and every browser resolves against
  // the request URL. It is the one form that cannot be pointed at another origin by a
  // forged `Host` header, which an absolute URL built from `request.url` can be.
  const headers = new Headers({ Location: path });
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
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
  // The belt's answer is taken before anything else and gates every write below. The
  // body is still read on a refusal, because parsing form fields changes nothing and
  // it is what lets a refused respondent land back on their own page rather than at
  // the site root.
  const admitted = isSameOriginPost(request);
  const form = await readForm(request);
  const target = safeReturnPath(
    formField(form, RETURN_FIELD),
    request.headers.get("referer") ?? undefined,
    configuredBaseUrl(),
  );
  if (!admitted) return seeOther(target);

  const offered = portalFontChoices().map((entry) => entry.key);
  const choice = parseAppearanceChoice(form, offered);
  return seeOther(target, appearanceCookiesFor(choice, secureCookies()));
}

/** One form field as a string, or `undefined` for an absent field or an upload. */
function formField(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}
