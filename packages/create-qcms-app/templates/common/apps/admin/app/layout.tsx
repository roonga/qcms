import { cookies } from "next/headers";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AppUpdate } from "@/components/app-update";
import { HydrationMarker } from "@/components/hydration-marker";
import { LocaleProvider } from "@/components/locale-context";
import { MODE_COOKIE, appearanceClassName, parseAppearance } from "@/lib/appearance";
import { t } from "@/lib/i18n/en";
import { PWA_PAGE_COLOR_DARK, PWA_PAGE_COLOR_LIGHT } from "@/lib/pwa/brand";
import { appLocale } from "@/lib/server/config";
import { SIDEBAR_ATTRIBUTE, SIDEBAR_COOKIE, parseSidebarSetting } from "@/lib/sidebar";

import "./globals.css";

export const metadata: Metadata = {
  title: t("app.title"),
  description: t("app.description"),
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: t("app.title"), statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /* `black-translucent` puts the status bar over the document, so the sticky top bar pads itself out
     of the inset that `cover` exposes. */
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: PWA_PAGE_COLOR_LIGHT },
    { media: "(prefers-color-scheme: dark)", color: PWA_PAGE_COLOR_DARK },
  ],
};

/* Render the no-script message unconditionally and reveal it with noscript CSS; only then hide all other
   body children. */
const REQUIRES_JS_CSS =
  "body>:not(.qcms-requires-js){display:none!important}" +
  ".qcms-requires-js{display:flex!important}";

export default async function AdminRootLayout({ children }: { readonly children: ReactNode }) {
  const cookieStore = await cookies();
  const appearance = parseAppearance(cookieStore.get(MODE_COOKIE)?.value);
  const sidebar = parseSidebarSetting(cookieStore.get(SIDEBAR_COOKIE)?.value);

  return (
    <html
      lang="en"
      className={appearanceClassName(appearance)}
      {...{ [SIDEBAR_ATTRIBUTE]: sidebar }}
    >
      <head>
        <noscript>
          <style>{REQUIRES_JS_CSS}</style>
        </noscript>
      </head>
      <body>
        {/* Mount at the shared root so the hydration marker runs after the whole page commits. */}
        <HydrationMarker />
        <a href="#main-content" className="skip-link">
          {t("action.skipToContent")}
        </a>
        <LocaleProvider locale={appLocale()}>{children}</LocaleProvider>
        <AppUpdate />
        <div className="qcms-requires-js">
          <div role="alert" className="qcms-requires-js__panel">
            <h1 className="qcms-requires-js__title">{t("requiresJs.title")}</h1>
            <p className="qcms-requires-js__body">{t("requiresJs.body")}</p>
          </div>
        </div>
      </body>
    </html>
  );
}
