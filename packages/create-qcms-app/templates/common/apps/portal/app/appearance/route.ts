import { RETURN_FIELD, appearanceCookiesFor } from "@/lib/appearance";
import {
  DEFAULT_RETURN,
  parseAppearanceChoice,
  safeReturnPath,
} from "@/lib/server/appearance-form";
import { portalBaseUrl, secureCookies } from "@/lib/server/config";
import { isSameOriginPost } from "@/lib/server/route-helpers";
import { portalFontChoices } from "@/lib/server/theme";

function seeOther(path: string, setCookies: readonly string[] = []): Response {
  const headers = new Headers({ Location: absoluteOnThisPortal(path) });
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/**
 * Configured rather than `request.url`, which carries an attacker-chosen `Host` on a
 * forged request. Falling back to the bare path stays safe because every path reaching
 * here has been through {@link safeReturnPath}.
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

async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    return new FormData();
  }
}

function configuredBaseUrl(): string | undefined {
  try {
    return portalBaseUrl();
  } catch {
    return undefined;
  }
}

export async function POST(request: Request): Promise<Response> {
  // SEC-9's belt first, and a refusal reads nothing the request carried: a request that
  // cannot prove its origin does not get to choose the redirect either.
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

function formField(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}
