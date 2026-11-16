import { headers } from "next/headers";

import { getCurrentStep } from "./api";
import { PATH_HEADER } from "./environment";
import { parseFormAppearance, sessionIdFromPath, type FormAppearance } from "./form-appearance";
import { readSessionToken } from "./session-cookie";

/**
 * The appearance frozen with the version this request's session is pinned to, or `null`
 * off a step page or when the step cannot be read: the page itself reports that failure.
 */
export async function sessionFormAppearance(): Promise<FormAppearance | null> {
  const sessionId = sessionIdFromPath((await headers()).get(PATH_HEADER));
  if (sessionId === undefined) return null;
  const token = await readSessionToken();
  if (token === undefined) return null;
  try {
    return parseFormAppearance((await getCurrentStep(sessionId, token)).appearance);
  } catch {
    return null;
  }
}
