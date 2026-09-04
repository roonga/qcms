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
 */
export default async function AdminRootLayout({ children }: { readonly children: ReactNode }) {
  const mode = parseMode((await cookies()).get(MODE_COOKIE)?.value);

  return (
    <html lang="en" className={mode ?? undefined}>
      <head>
        {/* Hidden with CSS rather than by not rendering it, so a scripted operator
            gets no hydration boundary and no layout shift. `style-src` already
            allows inline styles, so no nonce is involved.
            Task 032: both topbar triggers are popup menus, which need JavaScript to
            open, so both go. Sign-out does not - ending a session has to stay
            possible with scripts off (Code Owner decision, 2026-07-31), so the same
            rule reveals the plain POST form the account menu submits when it is
            scripted (`components/account-menu.tsx`). The appearance control has no
            such fallback and needs none: the sheet's `prefers-color-scheme` block
            still paints the page correctly, and a preference is not a session. */}
        <noscript>
          <style>
            {".qcms-appearance,.qcms-avatar{display:none}.qcms-signout-fallback{display:block}"}
          </style>
        </noscript>
      </head>
      <body>
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
