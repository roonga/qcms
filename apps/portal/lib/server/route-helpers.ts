import type { A2UIAnswerValue } from "@qcms/ui";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { isProduction } from "./config";
import { ApiError, type SubmitResponse } from "./api";

/**
 * Shared BFF route-handler helpers (task 029). Still strict-BFF duty only:
 * shaping proxy results and moving the session/receipt through httpOnly cookies.
 * No rule evaluation.
 */

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
  readonly values: Readonly<Record<string, A2UIAnswerValue>>;
  readonly errors: Readonly<Record<string, string>>;
  /**
   * Which constraint the API refused each answer on (task 048, ADR-32). The
   * default message in `errors` is resolved here in the route; the *author's*
   * message lives on the compiled step document, which only the re-render has,
   * so the constraint travels and `native-step` picks the wording. Optional so a
   * context cookie written by an earlier build still reads.
   */
  readonly constraints?: Readonly<Record<string, string>>;
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
    secure: isProduction(),
    path: "/",
    maxAge: RECEIPT_MAX_AGE_SECONDS,
  });
}

/** Read (and clear) the receipt cookie on the completion page. */
export async function readReceiptCookie(): Promise<SubmitResponse | undefined> {
  const store = await cookies();
  const raw = store.get(RECEIPT_COOKIE)?.value;
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as SubmitResponse;
  } catch {
    return undefined;
  }
}

/** Persist the no-JS step re-render context for the next flow-page render (044). */
export async function writeStepContext(ctx: StepContext): Promise<void> {
  const store = await cookies();
  store.set(STEP_CTX_COOKIE, JSON.stringify(ctx), {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
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
 * The wire shape of `STEP_CTX_COOKIE` (issue #327). The cookie is `httpOnly`, but
 * that only blocks script access from the page: it is unsigned, so a respondent
 * can set it by hand in their own browser and hand this seam any JSON they like.
 * The kernel parses everything it is handed and this BFF seam does the same, so
 * the `Partial<StepContext>` the caller gets back is a shape that was checked
 * rather than one that was asserted.
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
  values: z.record(z.string(), answerValueSchema).optional(),
  errors: z.record(z.string(), z.string()).optional(),
  constraints: z.record(z.string(), z.string()).optional(),
});

/**
 * Read the no-JS step re-render context on the flow page (044). Best-effort, and
 * total over hostile input: unparseable JSON and JSON that does not match
 * `stepContextSchema` both degrade to `undefined`, which is what an absent cookie
 * already returns, so a forged cookie costs the respondent their re-populated
 * values and nothing else. Never throws into a respondent's render.
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
  };
}
