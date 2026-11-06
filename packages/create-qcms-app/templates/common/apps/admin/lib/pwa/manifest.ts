import type { MetadataRoute } from "next";

import { t } from "@/lib/i18n/en";

import { PWA_ACCENT_COLOR, PWA_GROUND_COLOR } from "./brand";

/** Where an installed window opens. The identity below is deliberately not this, so moving it keeps the installed app. */
export const PWA_START_URL = "/questions";

export const MASKABLE_ICON_192 = "/pwa-icon-192";
export const MASKABLE_ICON_512 = "/pwa-icon-512";

/**
 * The installable manifest. Each PNG is listed under both purposes: Chromium selects its primary
 * icon from `any` alone, so a maskable-only set would not be installable.
 */
export function adminManifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: t("app.title"),
    short_name: t("app.title"),
    description: t("app.description"),
    start_url: PWA_START_URL,
    scope: "/",
    display: "standalone",
    background_color: PWA_GROUND_COLOR,
    theme_color: PWA_ACCENT_COLOR,
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: MASKABLE_ICON_192, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: MASKABLE_ICON_192, sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: MASKABLE_ICON_512, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: MASKABLE_ICON_512, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
