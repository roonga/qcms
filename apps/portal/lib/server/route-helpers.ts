import type { A2UIAnswerValue } from "@qcms/ui";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

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

/** Read the no-JS step re-render context on the flow page (044). Best-effort. */
export async function readStepContext(): Promise<StepContext | undefined> {
  const store = await cookies();
  const raw = store.get(STEP_CTX_COOKIE)?.value;
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<StepContext>;
    return {
      values: parsed.values ?? {},
      errors: parsed.errors ?? {},
    };
  } catch {
    return undefined;
  }
}
