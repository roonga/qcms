import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { t } from "@/lib/i18n/en";
import {
  portalCorners,
  portalMode,
  portalTheme,
  rootClassName,
  type PortalMode,
} from "@/lib/server/theme";

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

/** The three colour modes of the token contract (ADR-30); `light` is the base. */
const MODE_CLASS_LIST = "['light','dark','hc']";

/**
 * Colour-mode bootstrap (runs before first paint, so no flash and a correct
 * no-JS-less default). Priority: explicit `?mode=` URL param, then a `qcms-theme`
 * cookie, then the deployment's configured default (`QCMS_PORTAL_MODE`), then the
 * OS `prefers-color-scheme`. It only toggles a class on <html>; the token values
 * themselves live in theme.css. This is theme chrome, not client data state
 * (ADR-26 keeps the portal fetch-only).
 *
 * The respondent-facing switcher, its persistence, and defaulting from
 * `prefers-contrast: more` are task 053. Until then the `?mode=` param and the
 * cookie are the manual door that makes all three modes reachable (and testable)
 * without any UI, and `QCMS_PORTAL_MODE` is the per-deployment default.
 */
function themeBootstrap(configuredMode: PortalMode): string {
  // `configuredMode` is one of four literals validated by `portalMode()`, so the
  // interpolation below cannot carry anything but a known keyword.
  const fallback = configuredMode === "auto" ? "(m?'dark':'light')" : `'${configuredMode}'`;
  return `(function(){try{
var v=${MODE_CLASS_LIST};
var q=new URLSearchParams(location.search).get('mode');
var c=document.cookie.match(/(?:^|; )qcms-theme=(dark|light|hc)/);
var m=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
var t=q||(c&&c[1])||${fallback};
if(v.indexOf(t)<0)t='light';
var r=document.documentElement;
for(var i=0;i<v.length;i++)r.classList.remove(v[i]);
r.classList.add(t);
}catch(e){}})();`;
}

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // Per-deployment theme selection (ADR-30): the palette rides `data-theme`, the
  // colour mode and corner preset ride root classes. All three come from config -
  // there is no respondent selector in this slice.
  const mode = portalMode();
  const theme = portalTheme();
  const corners = portalCorners();
  return (
    <html
      lang="en"
      data-theme={theme}
      className={rootClassName(mode, corners)}
      suppressHydrationWarning
    >
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
            other prop is the bootstrap source built by `themeBootstrap` from one
            of four validated mode keywords, so nothing real can hide behind the
            suppression. Weakening the CSP to silence it is never an option.
            `e2e/csp-nonce.pw.ts` proves the whole chain instead. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeBootstrap(mode) }}
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
