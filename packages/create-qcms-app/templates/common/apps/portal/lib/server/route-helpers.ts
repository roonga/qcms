import type { A2UIAnswerValue } from "@roonga/qcms-ui";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { portalBaseUrl, secureCookies } from "./config";
import { ApiError, type SubmitResponse } from "./api";
import { logOriginBeltRefusal } from "./origin-belt-log";

/**
 * Shared BFF route-handler helpers: shaping proxy results and moving the session and
 * receipt through httpOnly cookies. No rule evaluation.
 */

/** SEC-9's CSRF belt. */
export function isSameOriginPost(request: Request): boolean {
  const allowed = admitsAsSameOrigin(request);
  if (!allowed) logOriginBeltRefusal(request);
  return allowed;
}

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
 * Split out so {@link isSameOriginPost} can log a refusal exactly once without the
 * decision growing a side effect: every `return false` here is one refusal, whichever
 * branch reached it.
 */
function admitsAsSameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) return fetchSite === "same-origin" || fetchSite === "none";
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  return origin === portalBaseUrl();
}

export const RECEIPT_COOKIE = "qcms_receipt";
const RECEIPT_MAX_AGE_SECONDS = 60 * 10;

/**
 * The no-JS step re-render context, written by the whole-step route right before its
 * 303 and read once by the flow page. The short max-age bounds staleness, because a
 * Server Component cannot delete a cookie during render, so it lapses rather than being
 * cleared.
 */
export const STEP_CTX_COOKIE = "qcms_step_ctx";
const STEP_CTX_MAX_AGE_SECONDS = 15;

export interface StepContext {
  /**
   * A key mapped to `undefined` is an explicit clear rather than an absence: the writer
   * recorded an answer whose value did not survive the round trip, so the re-render has
   * to blank the field rather than fall back to the answer the API still holds.
   * `mergeStepValues` is the only correct way to combine this with the stored answers.
   */
  readonly values: Readonly<Record<string, A2UIAnswerValue | undefined>>;
  readonly errors: Readonly<Record<string, string>>;
  /**
   * The constraint rather than the final string (ADR-32): the author's message lives on
   * the compiled step document, which only the re-render has. Optional, so a context
   * cookie written by an earlier build still reads.
   */
  readonly constraints?: Readonly<Record<string, string>>;
  /**
   * The API's own missing-required set, narrowed to the posted step. Nothing here
   * decides whether a question is required or answered; the route forwards what the API
   * said so the no-JS re-render can show it. Optional for the reason above.
   */
  readonly missingRequired?: readonly string[];
  readonly notice?: string;
}

export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, details: error.details } },
      { status: error.status },
    );
  }
  return NextResponse.json({ error: { code: "internal" } }, { status: 502 });
}

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

const receiptSchema = z.object({
  submittedAt: z.iso.datetime(),
  contentHash: z.string(),
});

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

const answerValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

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

const stepValuesSchema = z.record(z.string(), answerValueSchema.optional().catch(undefined));

const stepContextSchema = z.object({
  values: stepValuesSchema.optional(),
  errors: lenientRecord(z.string()).optional(),
  constraints: lenientRecord(z.string()).optional(),
  // Forgeable like every other member, and the worst a forged one buys is a message
  // beside a question in the forger's own render: the renderer intersects it with the
  // step's visible set, and the API still refuses the submit.
  missingRequired: z
    .array(z.unknown())
    .transform((raw) => raw.filter((q) => typeof q === "string"))
    .optional(),
  // A catalogue key, so the worst a forged one buys is one of the portal's own sentences
  // on the forger's own render: the view renders nothing for a key it does not know.
  notice: z.string().optional(),
});

/**
 * Total over hostile input: unparseable JSON and JSON that is not the envelope both
 * degrade to `undefined`, which is what an absent cookie returns, so a forged cookie
 * costs the respondent their re-populated values and nothing else. It never throws into
 * a respondent's render, which would be a blank page.
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
    // Spread rather than always present, so a caller testing for the key cannot tell "no
    // notice" from "a notice this build does not know".
    ...(parsed.data.notice === undefined ? {} : { notice: parsed.data.notice }),
  };
}
