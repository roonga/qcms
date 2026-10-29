import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";

import { AppearanceProvider, type AppearanceState } from "@/components/appearance-context";
import { LocaleProvider } from "@/components/locale-context";
import { currentBasePath } from "@/lib/server/environment";
import { DENSITY_COOKIE, FONT_COOKIE, MODE_COOKIE } from "@/lib/appearance";
import { t } from "@/lib/i18n/en";
import { appLocale, secureCookies } from "@/lib/server/config";
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
  width: "device-width",
  initialScale: 1,
};

// Generated per request rather than a static `metadata` object because the title is
// the deployment's own brand name.
export function generateMetadata(): Metadata {
  return { title: portalBrand().name, description: t("app.description") };
}

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const [headerList, cookieJar] = await Promise.all([headers(), cookies()]);
  const nonce = headerList.get("x-nonce") ?? undefined;

  // Resolved from the request's cookies (ADR-30) so the first paint is already correct
  // rather than corrected after hydration.
  const appearance = resolveAppearance({
    mode: cookieJar.get(MODE_COOKIE)?.value,
    font: cookieJar.get(FONT_COOKIE)?.value,
    density: cookieJar.get(DENSITY_COOKIE)?.value,
  });
  const configuredMode = portalMode();
  const theme = portalTheme();
  const corners = portalCorners();
  const brand = portalBrand();

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
    basePath: await currentBasePath(),
  };

  return (
    <html
      lang="en"
      data-theme={theme}
      // The token contract's scope carrier (ADR-38), presence-only: the stylesheets
      // match the bare attribute, and nothing reads the value.
      data-qcms-theme-scope=""
      className={rootClassName(appearance, corners)}
      suppressHydrationWarning
    >
      <head>
        {/* The `nonce` prop is required (SEC-9): Next does not nonce app-authored scripts, so dropping it gets this script CSP-blocked. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: modeBootstrapScript(configuredMode, appearance.modeChosen ? state.mode : null),
          }}
        />
        {/* Revealed by CSS rather than conditional rendering so the served HTML is one
            document either way: no hydration boundary and no layout shift. */}
        <noscript>
          <style>{".qcms-appearance__apply{display:inline-flex}"}</style>
        </noscript>
      </head>
      <body>
        <a href="#portal-main" className="skip-link">
          {t("action.skipToContent")}
        </a>
        {/* Read on the server and handed down so the server render and the hydrated
            render format dates identically. */}
        <LocaleProvider locale={appLocale()}>
          <AppearanceProvider value={state}>{children}</AppearanceProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
