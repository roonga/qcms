import { cookies, headers } from "next/headers";

import { getSessionStatus } from "./api";
import { secureCookies } from "./config";
import { PATH_HEADER } from "./environment";
import {
  isCompletionPath,
  packFormAppearance,
  parseFormAppearance,
  sessionIdFromPath,
  unpackFormAppearance,
  type FormAppearance,
} from "./form-appearance";
import { RECEIPT_MAX_AGE_SECONDS } from "./route-helpers";
import { readSessionToken } from "./session-cookie";

/** The completion page's copy of the submitted session's appearance; it lapses with the receipt. */
export const COMPLETION_APPEARANCE_COOKIE = "qcms_done_appearance";

/**
 * The appearance frozen with the version this request's session is pinned to, or `null`
 * off a session page or when the session cannot be read: the page itself reports that
 * failure. Read through the session status, never a step serve, so the layout evaluates
 * no flow and mints no roster.
 */
export async function sessionFormAppearance(): Promise<FormAppearance | null> {
  const path = (await headers()).get(PATH_HEADER);
  if (isCompletionPath(path)) {
    return unpackFormAppearance((await cookies()).get(COMPLETION_APPEARANCE_COOKIE)?.value);
  }
  const sessionId = sessionIdFromPath(path);
  if (sessionId === undefined) return null;
  const token = await readSessionToken();
  if (token === undefined) return null;
  try {
    return parseFormAppearance((await getSessionStatus(sessionId, token)).appearance);
  } catch {
    return null;
  }
}

/**
 * Called on submit while the session token is still held, since the completion page has
 * none. A form without an appearance clears any earlier form's copy.
 */
export async function rememberCompletionAppearance(
  sessionId: string,
  token: string,
): Promise<void> {
  let packed: string | undefined;
  try {
    const appearance = parseFormAppearance((await getSessionStatus(sessionId, token)).appearance);
    packed = appearance === null ? undefined : packFormAppearance(appearance);
  } catch {
    packed = undefined;
  }
  const store = await cookies();
  if (packed === undefined) {
    store.delete(COMPLETION_APPEARANCE_COOKIE);
    return;
  }
  store.set(COMPLETION_APPEARANCE_COOKIE, packed, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: RECEIPT_MAX_AGE_SECONDS,
  });
}
