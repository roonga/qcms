"use client";

import { createContext, useContext, type ReactNode } from "react";

import { DEFAULT_LOCALE } from "@/lib/i18n/format";

/**
 * The deployment's formatting locale, carried from the root layout so the same string
 * reaches the server render and the hydrated render, which is what keeps a formatted date
 * identical on both sides of hydration. A client bundle cannot read it from the
 * environment itself.
 *
 * The default applies only to a tree rendered without the provider, which is the unit
 * suites.
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

export function useAppLocale(): string {
  return useContext(LocaleContext);
}
