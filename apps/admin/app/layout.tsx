import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

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
 * The admin root layout (task 031).
 *
 * Deliberately thinner than the portal's. There is no inline theme-bootstrap script
 * here, and therefore no CSP nonce to thread: the admin's palette is QCMS's fixed
 * Cobalt identity rather than a respondent-selectable theme (ADR-26's two-surface
 * mandate), so light and dark are resolved by CSS alone (`color-scheme` plus the
 * `prefers-color-scheme` media query in theme.css). That keeps the admin's CSP free
 * of any `script-src` allowance for our own inline script - see `proxy.ts`.
 *
 * The skip link is the same structure as the portal's, so the keyboard walkthrough
 * and the axe gate inherited from task 030 start from a known-good shape.
 */
export default function AdminRootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#admin-main" className="skip-link">
          {t("action.skipToContent")}
        </a>
        {children}
      </body>
    </html>
  );
}
