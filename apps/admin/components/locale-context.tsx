"use client";

import { createContext, useContext, type ReactNode } from "react";

import { I18nProvider } from "@/components/kit";
import { DEFAULT_LOCALE } from "@/lib/i18n/format";

/**
 * The deployment's formatting locale (`QCMS_LOCALE`, Code Owner ruling 2026-10-19),
 * carried from the root layout to client components.
 *
 * The value is runtime configuration, so it is read on the server
 * (`lib/server/config.ts`) and handed down rather than baked into the client bundle. The
 * same string reaches the server render and the hydrated render, which keeps every
 * formatted value identical on both sides. Nothing in it is a secret: it is visible in
 * every date it formats.
 *
 * The provider also wraps react-aria's `I18nProvider`, because the kit's date pickers
 * otherwise take the BROWSER's locale, which react-aria cannot see during the server
 * render: a filter's date field could draw one segment order on the server and another
 * after hydration, the defect the ruling exists to end on the portal.
 *
 * The default only applies to a tree rendered without the provider (the unit suites);
 * every page goes through the layout.
 */
const LocaleContext = createContext<string>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  readonly locale: string;
  readonly children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>
      <I18nProvider locale={locale}>{children}</I18nProvider>
    </LocaleContext.Provider>
  );
}

/** The deployment's formatting locale. */
export function useAppLocale(): string {
  return useContext(LocaleContext);
}

/**
 * The locale the A2UI previews render on (issue #906).
 *
 * A preview shows an author what a RESPONDENT will see, so the tag has to be the one the
 * portal renders respondents on. Both apps read the one `QCMS_LOCALE` variable since the
 * 2026-10-19 ruling, and Compose forwards it to both, so the preview mirrors the portal
 * by configuration rather than by a pair of constants kept equal by a test.
 *
 * **The form's own `defaultLocale` is still the wrong answer**: it selects WHICH
 * localized strings the compiler writes into the document (ADR-11, invariant I3), and by
 * the time a step reaches the renderer that choice is baked into the stored bytes. What
 * is left for the renderer's `locale` prop is how react-aria formats and orders the
 * controls around that text, which the portal takes from `QCMS_LOCALE` too.
 *
 * A named hook rather than three `useAppLocale()` calls, so the seam issue #732 will
 * move (a respondent locale of their own) stays one place;
 * `lib/questions/renderer-surface.test.ts` asserts the three preview surfaces use it.
 */
export function usePreviewLocale(): string {
  return useAppLocale();
}
