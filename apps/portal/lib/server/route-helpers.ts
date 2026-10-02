import type { A2UIAnswerValue } from "@roonga/qcms-ui";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { portalBaseUrl, secureCookies } from "./config";
import { ApiError, type SubmitResponse } from "./api";
import { logOriginBeltRefusal } from "./origin-belt-log";

/**
 * Shared BFF route-handler helpers (task 029). Still strict-BFF duty only:
 * shaping proxy results and moving the session/receipt through httpOnly cookies.
 * No rule evaluation.
 */

/**
 * Reject a cross-site state-changing request (SEC-9's CSRF belt, issue #487).
 *
 * `SameSite=Lax` on the respondent session cookie is the primary control and it
 * already blocks a cross-site POST from carrying the cookie. This is the second
 * layer for clients that do not enforce it: a state-changing request must either
 * declare a same-origin `Sec-Fetch-Site` or carry an `Origin` matching this app's
 * own base URL. A request with neither is refused rather than assumed friendly.
 *
 * Returns `true` when the request may proceed.
 *
 * ## Refusing writes exactly one log line
 *
 * A refusal returns before any API call, so for a long time it produced no `api.call`
 * line and no error line either: the only server-side evidence of a locked-out
 * respondent was the *absence* of a line, which cannot be counted (issue #578).
 * `logOriginBeltRefusal` closes that. The call is here rather than at the four route
 * handlers on purpose - this function is the single choke point every state-changing
 * handler must pass through (`scripts/check-origin-guards.test.ts` derives them from
 * disk and fails if one does not), so one line per refusal, and no line on an
 * admitted request, are properties of this seam rather than of whoever edits a route
 * next. It costs the function its purity, which is the trade this docblock is making
 * explicit. It records classifications only, never a header value: see
 * `./origin-belt-log.ts` for why every field it emits is a constant.
 *
 * ## Why `Sec-Fetch-Site` is read first, and what the `Origin` fallback now reaches
 *
 * Not "for older clients", which is what the admin copy's comment used to imply and
 * which is actively misleading on the admin. On the portal the reasoning changed with
 * the policy, so both halves are written out.
 *
 * **Until task 073 the portal sent `Referrer-Policy: no-referrer`**, and per Fetch a
 * navigation POST (which is what a no-JS `<form method="post">` is) serializes its
 * `Origin` as the literal string `null` under that policy. So on the no-JS path a
 * current browser sent `Origin: null`, the `Origin` comparison below could never
 * match, and `Sec-Fetch-Site` was the only header doing any work. The admin learned
 * that the expensive way and still lives there (`docs/RETRO.md`, the 031 entry:
 * better-auth answered 403 to 100% of legitimate sign-ins for exactly this reason).
 *
 * **The portal now sends `same-origin`** (Code Owner, 2026-10-01, SEC-9 as amended),
 * because Next's Server Action handler compares a request's `Origin` to the `Host` and
 * refuses `null`, and the no-JS roster operation of a repeating group is a Server
 * Action (ADR-43 as amended, task 073). A navigation POST from a portal page therefore
 * now carries this portal's real origin, so the `Origin` branch below is **live on the
 * no-JS path too** rather than nearly dead.
 *
 * **What that does NOT change is the order or the acceptance rule.** `Sec-Fetch-Site`
 * is read first because it is the stronger signal: it distinguishes a same-origin
 * navigation from a cross-site one, while `Origin` only says who claims to have sent
 * the request. And `null` must still be refused, because a page can declare
 * `no-referrer` on itself to produce it. The rule is unchanged and only the set it
 * refuses has narrowed (ruling R-B1).
 *
 * The `Origin` branch was already live for the **hydrated** path, because `fetch()`
 * requests are mode `cors`, which no referrer policy touches, so those always carried
 * the real origin. (Written without the parentheses until issue #663 taught the admin
 * twin's `r2-import-surface.test.ts` to blank comments before scanning for a call to
 * the global. The portal's own R2 test still does not carry that rule at all, which is
 * its own asymmetry and its own issue.)
 *
 * ## Exactly what the belt covers, and what it does not
 *
 * **SEVEN callers**, and the seventh is not a route handler. Six POST route handlers call
 * this function directly: `POST /appearance`, `POST /f/{formSlug}/start`,
 * `POST /s/{sessionId}/answers`, `POST /s/{sessionId}/roster`,
 * `POST /s/{sessionId}/step` and `POST /s/{sessionId}/submit`. The seventh is the no-JS
 * Add and Remove of a repeating-group instance, a **Next Server Action**
 * (`app/s/[sessionId]/roster-action.ts`), which reaches the same decision through
 * {@link isSameOriginAction} below because an action is handed its form data and no
 * `Request`. `scripts/check-origin-guards.test.ts` derives both sets from disk, so seven
 * is a checked statement rather than a count someone kept up to date by hand, and
 * `docs/SECURITY_DESIGN.md` SEC-9 states the same number.
 *
 * `/s/{sessionId}/roster` is the sixth route, added by task 073: the SCRIPTED path's Add
 * or Remove. **The no-JS path's Add and Remove is belted too** (Code Owner, 2026-10-01,
 * ruling R-B2), and it is belted HERE rather than left to Next, because Next's own action
 * check is weaker in three ways: it admits a request carrying no `Origin` at all after
 * only a warning, it compares the host while ignoring the scheme, and it never reads
 * `Sec-Fetch-Site`. Next's check stands behind the belt rather than instead of it.
 *
 * Next's check is also why the portal serves `Referrer-Policy: same-origin` (SEC-9 as
 * amended, 2026-10-01): under `no-referrer` a navigation POST serializes its `Origin` as
 * the literal `null`, which Next refuses outright, so the action would never run far
 * enough to be belted.
 *
 * `/appearance` is the no-JS appearance form (issue #195), and it is the one belted
 * route where a refusal costs a respondent nothing they can see: no answer is lost,
 * the page returns unchanged, and only their colour mode, font or spacing choice fails
 * to take. It is belted anyway, because the gate above derives the set from disk and
 * an exemption would have to be argued afresh by every reader.
 *
 * **Secure-link entry is outside the belt entirely.** `app/l/[token]/route.ts`
 * exports only `GET`, and every call site above is a POST, so `/l/{token}` is never
 * belted. An affected browser starts a secure-link session normally.
 *
 * ## What this refuses that a respondent might not expect
 *
 * A browser that sends no `Sec-Fetch-Site` (Fetch Metadata predates Safari 16.4 and
 * Firefox 90) is refused **only if it also sends no matching `Origin`**, which since
 * 2026-10-01 is a narrower set than it was. Failing closed is the right side to err on
 * for a security belt, and it matches the admin twin, but it is a real cost on a public
 * respondent surface rather than a free one: the `Referrer-Policy` follow-up noted on
 * issue #487 is what the Code Owner settled on 2026-10-01 (SEC-9 as amended), and it is
 * what narrowed this.
 *
 * **The rule itself has deliberately not moved** (ruling R-B1). Its old justification
 * was that such a browser's only other signal is `Origin: null`, which an attacker's
 * page can also produce by declaring `Referrer-Policy: no-referrer` on itself, so the
 * two were indistinguishable. Under the portal's `same-origin` policy an honest
 * Fetch-Metadata-less browser posting from a portal page sends this portal's **real**
 * origin, which an attacker's page cannot forge, and the `Origin` leg below admits it.
 * What is still refused is a request carrying `null` or no `Origin` at all, because an
 * attacker's page can produce either. Whether that remaining set is still worth the
 * same accepted cost is a measurement question rather than a logic one, and it is
 * filed: issue #1024 re-measures the population, and issue #504's analysis is what it
 * updates.
 *
 * **This is not only the no-JS path**, which is how issue #504 framed it after
 * reading an earlier version of this comment (corrected in issue #579).
 * `components/entry-view.tsx` renders Begin as a plain `<form method="post">` with
 * no `onSubmit` and no client interception, so Begin is a navigation POST whether or
 * not the page hydrated. A refusal therefore blocks anonymous entry with JavaScript
 * working perfectly. The hydrated `fetch()` path is protected only because it sends a
 * real `Origin`; a client with neither signal is refused there too.
 *
 * So the locked-out population is anonymous-entry respondents plus no-JS secure-link
 * respondents, not every affected browser. The same browsers cannot work the no-JS
 * appearance form either, which is a real cost on a control that exists for
 * accessibility; it is the same trade, made once, not a second decision. The browser-share numbers are deliberately
 * not repeated here, because they age: `docs/SECURITY_DESIGN.md` §5 carries them and
 * `docs/operations.md` carries the operator runbook.
 *
 * ## Twin
 *
 * `apps/admin/lib/server/route-helpers.ts` carries the same function over
 * `adminBaseUrl()`. It is a copy for the reason `config.ts` gives: there is no
 * shared package for a Next BFF's server code. What keeps the two from drifting is
 * not the copy being small, it is `scripts/check-origin-guards.test.ts`, which
 * derives both apps' state-changing route handlers from disk and asserts each one
 * calls this function by name. The portal went four tasks without any origin check
 * while this document asserted one of both apps, which is what that gate exists to
 * turn into a red.
 *
 * Both sides now log their refusals (issue #620 followed this change), and the two log
 * modules stay twins in shape rather than in purpose. This one exists to count an
 * **accepted** loss: a measured share of ordinary respondents on browsers too old for
 * Fetch Metadata. The admin's exists to **detect** something, because every route it
 * covers is an authentication route and a burst of refusals there is not an old
 * browser. The earlier reading of that asymmetry, that the admin mattered less because
 * staff can be asked what they saw, holds only for accidental refusals: nobody reports
 * that they are probing a two-factor endpoint.
 *
 * The one place the divergence is visible in code is `BeltOutcome`. Three members
 * here, because a respondent can meet a 403 from the hydrated path; two on the admin,
 * because every refusal there is a 303 back to a screen and what varies is whether it
 * carries the generic-failure marker.
 */
export function isSameOriginPost(request: Request): boolean {
  const allowed = admitsAsSameOrigin(request);
  if (!allowed) logOriginBeltRefusal(request);
  return allowed;
}

/**
 * The same belt, for a caller that has headers rather than a `Request`: a **Next
 * Server Action** (task 073, ADR-43 as amended).
 *
 * An action is handed its form data and nothing else, so its own request reaches it
 * only through `headers()`. This wraps those headers, plus the path the action runs
 * against, back into the shape the belt reads, so the decision, the classification and
 * the refusal line are the ONE implementation rather than a second one written for the
 * action's shape.
 *
 * **It is belted at all because Next's own action check is weaker in three ways**
 * (Code Owner, 2026-10-01, ruling R-B2). Next compares the request's `Origin` to the
 * `Host` or `X-Forwarded-Host`, and: it **admits a request carrying no `Origin` at
 * all** after only a warning; it compares the host while **ignoring the scheme**; and
 * it **never reads `Sec-Fetch-Site`**. The belt refuses an absent and a `null` origin,
 * reads Fetch Metadata first, and compares against the full configured base URL
 * including its scheme. So the action gets the belt like every other state-changing
 * entry point, and Next's check stands behind it rather than instead of it.
 */
export function isSameOriginAction(headers: Headers, pathname: string): boolean {
  let url: string;
  try {
    url = new URL(pathname, portalBaseUrl()).toString();
  } catch {
    // An unreadable base URL is a configuration fault, and the belt fails closed on
    // one exactly as `classifyOrigin` reports `unverifiable` rather than throwing.
    return false;
  }
  return isSameOriginPost(new Request(url, { method: "POST", headers }));
}

/**
 * The belt's decision, unchanged and still pure.
 *
 * Split out so {@link isSameOriginPost} can log a refusal exactly once without the
 * decision itself growing a side effect: every `return false` in here is one refusal,
 * whichever branch reached it.
 */
function admitsAsSameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) return fetchSite === "same-origin" || fetchSite === "none";
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  return origin === portalBaseUrl();
}

/** A short-lived, httpOnly cookie carrying the submit receipt to the /done page. */
export const RECEIPT_COOKIE = "qcms_receipt";
const RECEIPT_MAX_AGE_SECONDS = 60 * 10;

/**
 * A short-lived, httpOnly cookie that carries the no-JS step re-render context
 * (task 044): the just-submitted answer values (so a page reload re-populates the
 * form instead of losing input) and any typed validation errors from the API (so
 * the re-rendered step fills its error slots, WCAG 3.3). Written by the whole-step
 * BFF route right before its 303 redirect, read once by the flow page on the
 * subsequent render. A short max-age bounds any staleness (a Server Component
 * cannot delete a cookie during render, so it lapses rather than being cleared).
 */
export const STEP_CTX_COOKIE = "qcms_step_ctx";
const STEP_CTX_MAX_AGE_SECONDS = 15;

/** The no-JS step re-render context (values to re-populate, errors to surface). */
export interface StepContext {
  /**
   * The just-submitted answers. A key mapped to `undefined` is an explicit
   * **clear**, not an absence: it means the writer recorded an answer for that
   * question but the value did not survive the round trip, so the re-render must
   * blank the field rather than fall back to the answer the API still holds. See
   * `mergeStepValues`, which is the only correct way to combine this with the
   * stored answers.
   */
  readonly values: Readonly<Record<string, A2UIAnswerValue | undefined>>;
  readonly errors: Readonly<Record<string, string>>;
  /**
   * Which constraint the API refused each answer on (task 048, ADR-32). The
   * default message in `errors` is resolved here in the route; the *author's*
   * message lives on the compiled step document, which only the re-render has,
   * so the constraint travels and `native-step` picks the wording. Optional so a
   * context cookie written by an earlier build still reads.
   */
  readonly constraints?: Readonly<Record<string, string>>;
  /**
   * The questions the API reports as still missing a required answer, narrowed to
   * the step that was just posted (issue #920).
   *
   * The set is the API's `flowState.missingRequired`, which the kernel computes
   * (`evaluateRules`, invariant I9) and which the hydrated `StepFlow` already gates
   * Continue and Submit on. Nothing here decides whether a question is required or
   * whether it is answered: the route forwards what the API said so the no-JS
   * re-render can show it, exactly as the scripted path shows it. Before this, a
   * no-JS respondent who left a required question blank got a silent reload of the
   * same step and no way to learn why.
   *
   * Optional for the same reason as `constraints`: a context cookie written by an
   * earlier build still reads.
   */
  readonly missingRequired?: readonly string[];
  /**
   * A page-level notice for a round trip that wrote NOTHING and has nothing per field to
   * say (task 073, ruling Q29, 2026-10-02).
   *
   * The one shape that needs it is a refused batch: a 429, a 5xx or a lost session refuses
   * the whole request, so there is no refused field to hang a message on, and the
   * re-render would otherwise be the same step with the same values and no explanation.
   * That is the silent reload issue #920 removed from the required-answer path, met here
   * from the other side, and it is what the Code Owner's ruling means by "not `errors: {}`
   * and silence".
   *
   * A KEY rather than a sentence, because the catalogue is where the portal's wording
   * lives and a cookie is not a place to put prose. The re-render looks it up; an
   * unrecognised key is ignored, so a cookie written by an earlier build still reads.
   *
   * Optional for the same reason as the two fields above.
   */
  readonly notice?: string;
}

/** Translate an API error into a same-status JSON response the client can branch on. */
export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, details: error.details } },
      { status: error.status },
    );
  }
  return NextResponse.json({ error: { code: "internal" } }, { status: 502 });
}

/** Persist the receipt for the completion page to read once, then clear. */
export async function writeReceiptCookie(receipt: SubmitResponse): Promise<void> {
  const store = await cookies();
  store.set(RECEIPT_COOKIE, JSON.stringify(receipt), {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: RECEIPT_MAX_AGE_SECONDS,
  });
}

/**
 * The wire shape of `RECEIPT_COOKIE` (issue #345). Same reasoning as
 * `stepContextSchema` below: `httpOnly` stops the page's own scripts reading the
 * cookie, but it is unsigned, so a respondent can hand-set it in their own
 * browser. This seam therefore checks what it hands the completion page instead
 * of asserting it.
 *
 * Strictness is pinned to what the **writer** can legitimately produce, which is
 * exactly one thing. `writeReceiptCookie` only ever stores what `submitSession`
 * returned, and the API builds that from the stored submission row as
 * `{ submittedAt: row.submittedAt.toISOString(), contentHash: row.contentHash }`.
 * So this mirrors the API's own `SubmitResponse` schema rather than a guess made
 * here: a legitimate receipt is refused only if the API breaks its own published
 * contract, never merely for differing from an invention on this side.
 *
 * `z.iso.datetime()` rather than a bare string because the completion page
 * renders the value through `new Date(...)`: a string that is not an instant
 * reaches the respondent as the literal text "Invalid Date". A bare string would
 * be a wider schema than the consumer actually needs, which is a false guarantee.
 *
 * Unknown members are stripped rather than fatal (plain `z.object`), so a later
 * API that adds a field to the receipt still reads on a deployment running this
 * build, while a forged extra member never reaches the page.
 */
const receiptSchema = z.object({
  submittedAt: z.iso.datetime(),
  contentHash: z.string(),
});

/**
 * Read (and clear) the receipt cookie on the completion page. Total over hostile
 * input, and every failure lands on the same answer an absent cookie already
 * returned: no cookie, unparseable JSON and JSON that is not a receipt are one
 * case, not three. `/done` then renders the neutral thank-you without the
 * reference, exactly as it has always done for a respondent whose short-lived
 * cookie lapsed before they revisited the page.
 *
 * Deliberately NOT a third "we could not confirm your receipt" state (issue
 * #345). The submission is already durable on the API side by the time this
 * cookie is read, so an alarming message here would cast doubt on a submission
 * that in fact succeeded, at the last moment a respondent sees. The only inputs
 * that reach the rejection branch are a lapsed cookie and one the respondent
 * forged themselves.
 */
export async function readReceiptCookie(): Promise<SubmitResponse | undefined> {
  const store = await cookies();
  const raw = store.get(RECEIPT_COOKIE)?.value;
  if (raw === undefined) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = receiptSchema.safeParse(json);
  if (!parsed.success) return undefined;
  return parsed.data;
}

/** Persist the no-JS step re-render context for the next flow-page render (044). */
export async function writeStepContext(ctx: StepContext): Promise<void> {
  const store = await cookies();
  store.set(STEP_CTX_COOKIE, JSON.stringify(ctx), {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: STEP_CTX_MAX_AGE_SECONDS,
  });
}

/**
 * One answered value as it survives a JSON round trip: the `A2UIAnswerValue`
 * union, with `readonly string[]` on the wire as a plain array.
 */
const answerValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

/**
 * A record whose entries must match `value`; an entry that does not is **dropped,
 * not fatal**. Per entry rather than all-or-nothing because one unreadable entry
 * must not cost the respondent the messages sitting beside it.
 *
 * Only for `errors` and `constraints`, where dropping really does mean "no
 * message for this question" and nothing downstream distinguishes the two. The
 * `values` record must NOT use this: there, dropping a key and clearing it are
 * different renders (see `stepValuesSchema`).
 */
function lenientRecord<T>(value: z.ZodType<T>) {
  return z.record(z.string(), z.unknown()).transform((raw) => {
    const kept: [string, T][] = [];
    for (const [key, entry] of Object.entries(raw)) {
      const parsed = value.safeParse(entry);
      if (parsed.success) kept.push([key, parsed.data]);
    }
    return Object.fromEntries(kept);
  });
}

/**
 * The `values` record: a key whose value does not read is **kept and cleared**
 * (mapped to an explicit `undefined`), never dropped.
 *
 * The distinction is load-bearing one seam downstream. `mergeStepValues` spreads
 * this over the answers the API still holds, and under a spread *absent*,
 * *present-but-undefined* and *never-written* are three different results: a
 * dropped key lets the stored answer show through, an explicit `undefined`
 * overrides it. So dropping is wrong here even though it is right for `errors`.
 *
 * The case that makes it concrete, and it is not hypothetical. A respondent has
 * an accepted number answer of `5` and edits it to `abc`. `step-form.ts` decodes
 * that to `NaN` (deliberately: it leaves the judgement to the API, which refuses
 * it), and `JSON.stringify` writes `NaN` as `null`. Drop that key and the step
 * re-renders the stale `5` beside "Enter a number", contradicting itself and
 * quietly replacing what the respondent typed with an old answer. Clearing it
 * blanks the field, which is what the pre-validation code did (its `null`
 * survived the cast and won the spread) and what the respondent expects.
 */
const stepValuesSchema = z.record(z.string(), answerValueSchema.optional().catch(undefined));

/**
 * The wire shape of `STEP_CTX_COOKIE` (issue #327). The cookie is `httpOnly`, but
 * that only blocks script access from the page: it is unsigned, so a respondent
 * can set it by hand in their own browser and hand this seam any JSON they like.
 * The kernel parses everything it is handed and this BFF seam does the same, so
 * the `StepContext` the caller gets back is a shape that was checked rather than
 * one that was asserted.
 *
 * Structure is strict and content is lenient, which is the split that matters
 * here: anything that is not this envelope is not a context we wrote, so it is
 * refused outright, while a member that IS the right kind of container keeps the
 * entries that read and drops the ones that do not. Either way nothing
 * unvalidated reaches the renderer.
 *
 * Every member is optional because the cookie is a re-render convenience, not a
 * contract: a context written by an earlier build (before `constraints` existed)
 * still reads, and a member the writer omitted becomes the empty record below,
 * exactly as the previous `?? {}` did.
 *
 * Keys are unconstrained on purpose. They are question ids plus the honeypot's
 * name, and narrowing them to a prefix would silently drop answers rather than
 * hardening anything: the prototype-key hazard lives in the *lookup* that reads
 * them (`isAuthoredKey`, issue #324), not in carrying the string.
 */
const stepContextSchema = z.object({
  values: stepValuesSchema.optional(),
  errors: lenientRecord(z.string()).optional(),
  constraints: lenientRecord(z.string()).optional(),
  // Question ids, so entries that are not strings are dropped rather than fatal -
  // the same lenience the two records above get, for the same reason. Like every
  // other member it is respondent-forgeable, and like `errors` the worst a forged
  // one buys is a message beside a question in the forger's own render: the
  // renderer intersects it with the step's visible set, and the API - which never
  // reads this cookie - still refuses the submit (issue #920).
  missingRequired: z
    .array(z.unknown())
    .transform((raw) => raw.filter((q) => typeof q === "string"))
    .optional(),
  // A catalogue KEY for a page-level notice (task 073, ruling Q29). Forgeable like every
  // other member, and the worst a forged one buys is one of the portal's own sentences on
  // the forger's own render: the view matches the key against the ones it knows and renders
  // nothing for anything else, so there is no way to put chosen text on the page.
  notice: z.string().optional(),
});

/**
 * Read the no-JS step re-render context on the flow page (044). Best-effort, and
 * total over hostile input: unparseable JSON and JSON that is not the context
 * envelope both degrade to `undefined`, which is what an absent cookie already
 * returns, so a forged cookie costs the respondent their re-populated values and
 * nothing else. Never throws into a respondent's render, which is a blank page.
 */
export async function readStepContext(): Promise<StepContext | undefined> {
  const store = await cookies();
  const raw = store.get(STEP_CTX_COOKIE)?.value;
  if (raw === undefined) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = stepContextSchema.safeParse(json);
  if (!parsed.success) return undefined;
  return {
    values: parsed.data.values ?? {},
    errors: parsed.data.errors ?? {},
    constraints: parsed.data.constraints ?? {},
    missingRequired: parsed.data.missingRequired ?? [],
    // Spread rather than always present, because `StepContext.notice` is optional and an
    // explicit `undefined` would make "no notice" and "a notice this build does not know"
    // read differently to a caller testing for the key.
    ...(parsed.data.notice === undefined ? {} : { notice: parsed.data.notice }),
  };
}
