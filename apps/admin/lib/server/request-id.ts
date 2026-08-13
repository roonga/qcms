import { headers } from "next/headers";

export const REQUEST_ID_HEADER = "x-request-id";
const MAX_LENGTH = 200;

export function normalizeRequestId(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" || trimmed.length > MAX_LENGTH ? undefined : trimmed;
}

export async function currentRequestId(): Promise<string | undefined> {
  try {
    return normalizeRequestId((await headers()).get(REQUEST_ID_HEADER));
  } catch {
    return undefined;
  }
}
