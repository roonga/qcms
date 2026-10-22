"use client";

import { createContext, useContext, type ReactNode } from "react";

import { DEFAULT_LOCALE } from "@/lib/i18n/format";

/**
 * The deployment's formatting locale (`QCMS_LOCALE`, Code Owner ruling 2026-10-19),
 * carried from the root layout to client components.
 *
 * The value is read on the server (`lib/server/config.ts`), because it is runtime
 * configuration and a client bundle cannot read the process environment. The layout
 * passes it here, and the same string reaches the server render and the hydrated render,
 * which is what keeps a formatted date or a date field's segment order identical on both
 * sides of hydration. Nothing in it is a secret: it is visible in every date it formats.
 *
 * The default only applies to a tree rendered without the provider, which is the unit
 * suites; every page goes through the layout.
 */
const LocaleContext = createContext<string>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  readonly locale: string;
  readonly children: ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** The deployment's formatting locale. */
export function useAppLocale(): string {
  return useContext(LocaleContext);
}
