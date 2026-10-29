"use client";

import { createContext, useContext, type ReactNode } from "react";

import { DEFAULT_LOCALE } from "@/lib/i18n/format";

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
