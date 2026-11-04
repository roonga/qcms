"use client";

import { createContext, useContext, type ReactNode } from "react";

import { isoDateLocale } from "@roonga/qcms-ui/native-submit";

import { I18nProvider } from "@/components/kit";
import { DEFAULT_LOCALE } from "@/lib/i18n/format";

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
      <I18nProvider locale={isoDateLocale(locale)}>{children}</I18nProvider>
    </LocaleContext.Provider>
  );
}

export function useAppLocale(): string {
  return useContext(LocaleContext);
}

export function usePreviewLocale(): string {
  return useAppLocale();
}
