import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";

import { AppearanceProvider, type AppearanceState } from "@/components/appearance-context";
import { DENSITY_COOKIE, FONT_COOKIE, MODE_COOKIE } from "@/lib/appearance";
import { t } from "@/lib/i18n/en";
import { secureCookies } from "@/lib/server/config";
import { modeBootstrapScript } from "@/lib/server/mode-bootstrap";
import {
  modeClass,
  portalBrand,
  portalCorners,
  portalFontChoices,
  portalMode,
  portalTheme,
  resolveAppearance,
  rootClassName,
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
  // hydrate against and then reconcile with the live root class - the pre-paint
  // bootstrap can have landed elsewhere from a valid `?mode=` parameter or the OS
  // signals (`lib/server/mode-bootstrap.ts`).
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
    secureCookies: secureCookies(),
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
            other prop is the bootstrap source built by `modeBootstrapScript`
            from validated mode keywords, so nothing real can hide behind the
            suppression. Weakening the CSP to silence it is never an option.
            `e2e/csp-nonce.pw.ts` proves the whole chain instead. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: modeBootstrapScript(configuredMode, appearance.modeChosen ? state.mode : null),
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
