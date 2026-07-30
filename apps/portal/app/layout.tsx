import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";

import { AppearanceProvider, type AppearanceState } from "@/components/appearance-context";
import {
  APPEARANCE_MODES,
  DENSITY_COOKIE,
  FONT_COOKIE,
  MODE_COOKIE,
  type AppearanceMode,
} from "@/lib/appearance";
import { t } from "@/lib/i18n/en";
import { isProduction } from "@/lib/server/config";
import {
  modeClass,
  portalBrand,
  portalCorners,
  portalFontChoices,
  portalMode,
  portalTheme,
  resolveAppearance,
  rootClassName,
  type PortalMode,
} from "@/lib/server/theme";

import "./globals.css";

export const viewport: Viewport = {
  // Mobile-first: respondents open registration links on phones (ADR-26).
  width: "device-width",
  initialScale: 1,
};

/**
 * The document title is the operator's brand name, so it is generated per request
 * rather than declared as a static `metadata` object (task 053, folding issue #25):
 * a `<title>` reading "QCMS" told a respondent the name of the engine instead of
 * the name of whoever sent them the link, and it was a source literal an adopter
 * could only change by editing this file.
 */
export function generateMetadata(): Metadata {
  return { title: portalBrand().name, description: t("app.description") };
}

/** The three colour modes of the token contract (ADR-30); `light` is the base. */
const MODE_CLASS_LIST = `['${APPEARANCE_MODES.join("','")}']`;

/**
 * Colour-mode bootstrap (runs before first paint, so no flash).
 *
 * Mode is the ONE axis that still needs a script, and it is worth being precise
 * about why, because font and density deliberately do not have one. All three
 * choices are cookies, so the server resolves them and stamps the root classes
 * into the first byte of HTML - no script, no flash, nothing to correct. But mode
 * has a fourth input the server cannot see: the respondent's OS signals. Only the
 * browser knows `prefers-color-scheme` and `prefers-contrast`, so when there is no
 * explicit choice to honour, this script is the only thing that can apply them,
 * and it runs synchronously in `<head>` so it does so before anything is painted.
 *
 * Priority: an explicit `?mode=` URL param, then the `qcms-theme` cookie, then -
 * only when the deployment's configured default is `auto` - the OS signals, and
 * otherwise the configured mode. `auto` is precisely the config value that means
 * "ask the OS", so a deployment that pins a mode is not second-guessed here.
 *
 * Among the OS signals, `prefers-contrast: more` wins over
 * `prefers-color-scheme: dark`. A contrast preference is an accessibility need
 * stated by someone who went into their system settings to state it; a colour
 * preference is usually comfort. Honouring the weaker signal first would hand a
 * respondent who asked for more contrast a dark theme instead.
 *
 * It only toggles a class on `<html>`; the token values live in theme.css. This is
 * theme chrome, not client data state (ADR-26 keeps the portal fetch-only).
 * `forced-colors` / Windows High Contrast Mode is a separate baseline (issue #28)
 * and is deliberately NOT read here.
 */
function themeBootstrap(configuredMode: PortalMode, cookieMode: AppearanceMode | null): string {
  // `configuredMode` is one of four literals validated by `portalMode()` and
  // `cookieMode` one of three or null, so the interpolations below cannot carry
  // anything but a known keyword.
  const osFallback = "(c?'hc':d?'dark':'light')";
  const fallback = configuredMode === "auto" ? osFallback : `'${configuredMode}'`;
  // The server already stamped the cookie's mode, so re-reading the cookie here
  // would be redundant work in the common case. It is still read, and it is read
  // FIRST, because a cookie written by the controls after this page was served (a
  // back navigation to a cached document) must not be overridden by config.
  const cookie = cookieMode === null ? "null" : `'${cookieMode}'`;
  return `(function(){try{
var v=${MODE_CLASS_LIST};
var q=new URLSearchParams(location.search).get('mode');
var k=document.cookie.match(/(?:^|; )qcms-theme=(dark|light|hc)/);
var m=window.matchMedia;
var d=m&&m('(prefers-color-scheme: dark)').matches;
var c=m&&m('(prefers-contrast: more)').matches;
var t=q||(k&&k[1])||${cookie}||${fallback};
if(v.indexOf(t)<0)t='light';
var r=document.documentElement;
for(var i=0;i<v.length;i++)r.classList.remove(v[i]);
r.classList.add(t);
}catch(e){}})();`;
}

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const [headerList, cookieJar] = await Promise.all([headers(), cookies()]);
  const nonce = headerList.get("x-nonce") ?? undefined;

  // Per-deployment theming (ADR-30): the palette rides `data-theme`, the colour
  // mode, corner preset, font and density ride root classes. Corners and the
  // palette are config only; mode, font and density are the respondent's choices
  // over the deployment's defaults (task 053), resolved from the request's cookies
  // so the FIRST PAINT is already correct rather than corrected afterwards.
  const appearance = resolveAppearance({
    mode: cookieJar.get(MODE_COOKIE)?.value,
    font: cookieJar.get(FONT_COOKIE)?.value,
    density: cookieJar.get(DENSITY_COOKIE)?.value,
  });
  const configuredMode = portalMode();
  const theme = portalTheme();
  const corners = portalCorners();
  const brand = portalBrand();

  // What the header's controls need. Everything in it is already visible in the
  // served HTML (the root classes) or is public config; nothing server-only crosses
  // this boundary. `mode` here is the class this render STAMPED, which the controls
  // hydrate against and then reconcile with the live root class - the script above
  // can have landed elsewhere from a `?mode=` parameter or the OS signals.
  const state: AppearanceState = {
    mode: modeClass(appearance.mode),
    font: appearance.font,
    density: appearance.density,
    fonts: portalFontChoices().map((entry) => ({
      key: entry.key,
      label: entry.label,
      group: entry.group,
    })),
    brandName: brand.name,
    brandLogoSrc: brand.logoSrc,
    secureCookies: isProduction(),
  };

  return (
    <html
      lang="en"
      data-theme={theme}
      className={rootClassName(appearance, corners)}
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
            other prop is the bootstrap source built by `themeBootstrap` from
            validated mode keywords, so nothing real can hide behind the
            suppression. Weakening the CSP to silence it is never an option.
            `e2e/csp-nonce.pw.ts` proves the whole chain instead. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: themeBootstrap(configuredMode, appearance.modeChosen ? state.mode : null),
          }}
        />
        {/* Without scripting the appearance controls cannot do anything, and a
            radio a respondent can move that changes nothing is worse than no
            control at all: it reads as a broken page. The configured default plus
            the server render still give a no-JS respondent a correct page, and
            `style-src` already allows inline styles, so no nonce is involved.
            Hidden with CSS rather than by not rendering it, so a scripted
            respondent gets no hydration boundary and no layout shift. */}
        <noscript>
          <style>{".qcms-appearance{display:none}"}</style>
        </noscript>
      </head>
      <body>
        <a href="#portal-main" className="skip-link">
          {t("action.skipToContent")}
        </a>
        <AppearanceProvider value={state}>{children}</AppearanceProvider>
      </body>
    </html>
  );
}
