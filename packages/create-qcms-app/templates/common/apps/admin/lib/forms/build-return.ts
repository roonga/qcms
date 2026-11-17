import { builderPath, NEW_FORM_PATH } from "../shell/modes.ts";

/** Per tab, so a second tab's journey never decides where this one's Exit goes. */
export const BUILDER_RETURN_KEY = "qcms-builder-return";

/** Only resolves a recorded relative address; nothing is fetched from it. */
const PARSE_BASE = "https://qcms.invalid";

function formPage(formId: string): string {
  return `/forms/${encodeURIComponent(formId)}`;
}

/**
 * Where the publish wizard sends the author back to, `undefined` when no `returnTo` was asked for.
 * Only this form's own build screen is honoured, compared as an exact path, so an absolute,
 * protocol-relative or re-encoded address, or another form's builder, falls back to the form page.
 */
export function publishReturnHref(
  formId: string,
  raw: string | readonly string[] | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  // Several values are never one path, so joining them can only fail the comparison.
  const value = typeof raw === "string" ? raw : raw.join("&");
  return value === builderPath(formId) ? value : formPage(formId);
}

/** The places a builder may hand back to: the forms list, the New form screen and the same form's page. */
function isEntryPoint(pathname: string, formId: string): boolean {
  return pathname === "/forms" || pathname === NEW_FORM_PATH || pathname === formPage(formId);
}

/**
 * Exit's destination: the New form screen for a new form, else the entry point this tab recorded
 * when it is one this form may return to, else the form page.
 */
export function builderExitHref(formId: string | null, cameFrom: string | null): string {
  if (formId === null) return NEW_FORM_PATH;
  if (cameFrom === null || !cameFrom.startsWith("/") || cameFrom.startsWith("//")) {
    return formPage(formId);
  }
  let url: URL;
  try {
    url = new URL(cameFrom, PARSE_BASE);
  } catch {
    return formPage(formId);
  }
  if (url.origin !== PARSE_BASE || !isEntryPoint(url.pathname, formId)) {
    return formPage(formId);
  }
  return `${url.pathname}${url.search}`;
}

/** The address a later Exit may return to, or `undefined` for a build route, which is never one. */
export function rememberedBuilderReturn(pathname: string, search: string): string | undefined {
  if (pathname.endsWith("/build")) return undefined;
  return `${pathname}${search}`;
}

export function editByHandHref(formId: string): string {
  return formPage(formId);
}

export function sharePreviewHref(formId: string): string {
  return `${formPage(formId)}/preview`;
}

export function builderPublishHref(formId: string): string {
  return `${formPage(formId)}/publish?returnTo=${encodeURIComponent(builderPath(formId))}`;
}
