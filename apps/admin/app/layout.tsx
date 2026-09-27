import { cookies } from "next/headers";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { HydrationMarker } from "@/components/hydration-marker";
import { MODE_COOKIE, parseMode } from "@/lib/appearance";
import { t } from "@/lib/i18n/en";

import "./globals.css";

export const metadata: Metadata = {
  title: t("app.title"),
  description: t("app.description"),
  // The admin is an internal tool behind auth; keep it out of every index even if
  // an operator exposes it publicly by mistake.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * The admin root layout (task 031; mode stamping added by task 055).
 *
 * Deliberately thinner than the portal's, and it stays that way: there is still no
 * inline theme-bootstrap script here, and therefore no CSP nonce to thread for one -
 * which keeps the app's CSP free of any `script-src` allowance of our own (see
 * `lib/server/csp.ts`).
 *
 * Mode is resolved in two halves, and the split is what removes the script:
 *
 * - An EXPLICIT choice is a cookie, readable here, stamped as the root class before
 *   a byte of HTML leaves. No flash, and no client code involved in the first paint.
 * - NO choice means no class at all, and the token sheet's own
 *   `prefers-color-scheme` block then applies the dark values (`app/theme.css`).
 *   That is the one input a server cannot see, handled by the one mechanism that
 *   does not need to run in the document.
 *
 * High-contrast is never inferred by either half, which is the constraint task 055
 * makes explicit: `.hc` appears only when the cookie says the operator chose it.
 *
 * Reading a cookie makes every route dynamic. That costs nothing here: every screen
 * in this app is already per-request (session lookups, search params), and there is
 * no page worth caching in an authoring tool behind auth.
 *
 * The skip link is the same structure as the portal's, so the keyboard walkthrough
 * and the axe gate inherited from task 030 start from a known-good shape.
 *
 * THIS LAYOUT IS ALSO WHERE THE APP STOPS WITHOUT JAVASCRIPT - see `REQUIRES_JS_CSS`.
 */

/**
 * The scripting gate (Code Owner, 2026-09-27: the admin requires JavaScript and stops at
 * a message without it, recorded in `plan/admin-design-contracts.md`).
 *
 * This is the first place every admin route passes through, sign-in included, so it is the
 * only place the check has to be made once. Below it there is nothing to check: no screen
 * in this app has a scriptless mode to fall back to.
 *
 * ## The mechanism, and why it is this one
 *
 * A `<noscript><style>` in `<head>`, hiding every child of `<body>` except the message.
 * Three properties made it the simplest thing that works:
 *
 * - **It needs no nonce and no CSP change.** `lib/server/csp.ts` grants
 *   `style-src 'self' 'unsafe-inline'` because Tailwind injects a stylesheet, so an inline
 *   `<style>` is already allowed. The alternative directions both cost more than they
 *   return: a hash would have to be recomputed by hand on every edit to the rule, and the
 *   nonce is threaded for `script-src` only and deliberately never reaches React
 *   (`lib/server/csp.ts` explains why the admin avoids that propagation entirely).
 * - **Nothing script-shaped is involved**, so the app's `script-src` stays free of any
 *   allowance of our own. A gate written as `document.documentElement.classList.add(...)`
 *   would be the one thing that cannot run in the case it exists for.
 * - **No flash with scripting ON.** The message is `display: none` from `globals.css`, a
 *   stylesheet in `<head>`, so it is hidden before the first paint rather than by client
 *   code after it. The `<noscript>` rule is never applied at all in that case, because the
 *   browser does not parse `<noscript>` content as CSS when scripting is enabled.
 *
 * `display: none` on the hidden half rather than `visibility` or an offscreen shift,
 * because the requirement is that nothing else is usable: `display: none` removes the
 * subtree from the tab order and from the accessibility tree together, so the sign-in
 * form behind the message is neither focusable nor announced.
 *
 * `!important` on both rules, which is not a specificity fight. Next injects the
 * `globals.css` link into the same `<head>`, and the relative order of that link and this
 * element is Next's business rather than ours: an override that must win whatever the
 * sheet order is says so, rather than depending on it.
 *
 * What this REPLACED is worth naming, because two comments elsewhere still describe it.
 * The block used to hide the two topbar menu triggers and reveal the plain POST sign-out
 * form beside them (task 032, and the Code Owner's 2026-07-31 sign-out decision). Both
 * rules are dead now: the whole shell is hidden, so there is no topbar to correct. The
 * form itself stays in `components/account-menu.tsx` - the scripted menu item submits it
 * with `requestSubmit()`, which is why there is one sign-out path in the app and not two.
 */
const REQUIRES_JS_CSS =
  "body>:not(.qcms-requires-js){display:none!important}" +
  ".qcms-requires-js{display:flex!important}";

export default async function AdminRootLayout({ children }: { readonly children: ReactNode }) {
  const mode = parseMode((await cookies()).get(MODE_COOKIE)?.value);

  return (
    <html lang="en" className={mode ?? undefined}>
      <head>
        {/* The scripting gate. See `REQUIRES_JS_CSS` above for the whole argument. */}
        <noscript>
          <style>{REQUIRES_JS_CSS}</style>
        </noscript>
      </head>
      <body>
        {/* First in the body so that a reader with scripting off meets the message
            before anything else in document order, which is the order a screen reader
            walks whatever a stylesheet does to the rest. `role="alert"` sits on the
            panel rather than the full-height centring wrapper, so the announced region
            is the two strings and not a page-sized box; the `<h1>` is what a heading
            walk finds, since this really is the page's only content in that state. */}
        <div className="qcms-requires-js">
          <div role="alert" className="qcms-requires-js__panel">
            <h1 className="qcms-requires-js__title">{t("requiresJs.title")}</h1>
            <p className="qcms-requires-js__body">{t("requiresJs.body")}</p>
          </div>
        </div>
        {/* Renders nothing. It stamps `data-qcms-hydrated` on `<html>` from a mount
            effect, which is the only truthful moment for the browser suite to wait
            for before it types into a server-rendered form (issue #210): react-aria's
            controlled inputs discard anything typed before React attaches, silently.
            Mounted here rather than per screen because this is the one root every
            admin page shares and nothing under `app/` declares a Suspense boundary,
            so this effect runs after the whole page has committed. */}
        <HydrationMarker />
        <a href="#main-content" className="skip-link">
          {t("action.skipToContent")}
        </a>
        {children}
      </body>
    </html>
  );
}
