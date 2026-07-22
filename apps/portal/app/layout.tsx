import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { t } from "@/lib/i18n/en";

import "./globals.css";

export const metadata: Metadata = {
  title: t("app.title"),
  description: t("app.description"),
};

export const viewport: Viewport = {
  // Mobile-first: respondents open registration links on phones (ADR-26).
  width: "device-width",
  initialScale: 1,
};

/**
 * Theme bootstrap (runs before first paint, so no flash and a correct no-JS-less
 * default). Priority: explicit `?theme=` URL param, then a `qcms-theme` cookie,
 * then the OS `prefers-color-scheme`. It only toggles a class on <html>; the
 * token values themselves live in theme.css / adopter-theme.css. This is theme
 * chrome, not client data state (ADR-26 keeps the portal fetch-only).
 */
const THEME_BOOTSTRAP = `(function(){try{
var p=new URLSearchParams(location.search).get('theme');
var c=document.cookie.match(/(?:^|; )qcms-theme=(dark|light)/);
var m=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
var t=p||(c&&c[1])||(m?'dark':'light');
document.documentElement.classList.remove('dark','light');
document.documentElement.classList.add(t==='dark'?'dark':'light');
}catch(e){}})();`;

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <head>
        {/* The CSP nonce is present on the server-rendered script but stripped
            from the client HTML (Next serializes no nonce to the browser, by
            design - SEC-9), so server and client markup differ on this attribute.
            That difference is expected, not a bug, so suppress React's hydration
            warning for this element (finding A). The nonce still authorizes the
            inline script server-side; the CSP is not weakened. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }}
        />
      </head>
      <body>
        <a href="#portal-main" className="skip-link">
          {t("action.skipToContent")}
        </a>
        {children}
      </body>
    </html>
  );
}
