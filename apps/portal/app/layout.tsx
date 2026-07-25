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
        {/* The per-request CSP nonce (SEC-9) reaches SSR on the `x-nonce` request
            header `proxy.ts` sets, and it IS propagated: the served HTML
            stamps the real value and the RSC payload carries the same value, so
            React's server and client trees agree. Next does not nonce app-authored
            scripts for us (dropping this prop gets the script CSP-blocked), so the
            prop is required.

            `suppressHydrationWarning` is still needed, for a reason that has
            nothing to do with propagation (issue #20). On insertion the browser
            performs the HTML specification's *nonce hiding*: it moves the value
            into the element's internal `[[CSPNonce]]` slot (readable as the
            `.nonce` property) and blanks the `nonce` content attribute, so a CSS
            attribute selector cannot exfiltrate it. React's hydration check reads
            the attribute back with `getAttribute("nonce")`, sees `""` against its
            own real value, and reports an attribute difference it explicitly does
            not patch up. The DOM, the executed script, and the enforcing nonce are
            all unaffected: only the warning is spurious, and this element's only
            other prop is a module-level constant string, so nothing real can hide
            behind the suppression. Weakening the CSP to silence it is never an
            option. `e2e/csp-nonce.pw.ts` proves the whole chain instead. */}
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
