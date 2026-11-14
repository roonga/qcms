import type { MailMessage } from "./mailer.js";

export type SignInLinkPurpose = "account-created" | "reactivated" | "reset";

/** Every emailed sign-in link is single-use and lives this long (`docs/WORKSPACE_ACCESS.md`, section 7). */
export const SIGN_IN_LINK_TTL_HOURS = 72;

interface SignInLinkCopy {
  readonly subject: string;
  readonly intro: string;
  readonly action: string;
}

const EN: Readonly<Record<SignInLinkPurpose, SignInLinkCopy>> = {
  "account-created": {
    subject: "Your QCMS account",
    intro: "An account has been created for you on QCMS.",
    action: "Sign in to set your password and set up two-step verification",
  },
  reactivated: {
    subject: "Your QCMS account has been reactivated",
    intro: "Your QCMS account has been reactivated.",
    action: "Sign in to set a new password and set up two-step verification",
  },
  reset: {
    subject: "Sign in to QCMS again",
    intro: "Your QCMS sign-in has been reset.",
    action: "Sign in to finish setting up your account",
  },
};

const EN_COMMON = {
  expiry: (hours: number) => `This link works once and expires in ${String(hours)} hours.`,
  ignore: "If you did not expect this message, you can ignore it.",
};

/**
 * Resolves a path against the admin origin and refuses anything that would leave it, so a
 * link can never be pointed at another host.
 */
export function adminLink(linkBaseUrl: string, pathAndQuery: string): string {
  if (!pathAndQuery.startsWith("/") || pathAndQuery.startsWith("//")) {
    throw new Error("adminLink takes a path on the admin origin");
  }
  const base = new URL(linkBaseUrl);
  const url = new URL(pathAndQuery, base);
  if (url.origin !== base.origin) throw new Error("adminLink resolved off the admin origin");
  return url.href;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * The link is the only variable content: no name, address, workspace or password reaches the
 * body, so a forwarded or intercepted message discloses nothing the link itself does not.
 */
export function signInLinkMessage(
  to: string,
  purpose: SignInLinkPurpose,
  link: string,
): MailMessage {
  const copy = EN[purpose];
  const expiry = EN_COMMON.expiry(SIGN_IN_LINK_TTL_HOURS);
  const text = [copy.intro, "", `${copy.action}:`, link, "", expiry, EN_COMMON.ignore, ""].join(
    "\n",
  );
  const href = escapeHtml(link);
  const html = [
    "<!doctype html>",
    '<html lang="en"><body>',
    `<p>${escapeHtml(copy.intro)}</p>`,
    `<p><a href="${href}">${escapeHtml(copy.action)}</a></p>`,
    `<p>${escapeHtml(expiry)}<br>${escapeHtml(EN_COMMON.ignore)}</p>`,
    "</body></html>",
    "",
  ].join("\n");
  return { to, subject: copy.subject, text, html };
}
