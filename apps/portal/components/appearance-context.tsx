"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { AppearanceMode, Density } from "@/lib/appearance";

export interface FontChoice {
  readonly key: string;
  readonly label: string;
  readonly group: string;
}

export interface AppearanceState {
  /**
   * The mode the server stamped on `<html>`, which is not necessarily the mode in
   * force: the pre-paint script can resolve a different one after this render was
   * generated, so the controls re-read the live root class once on mount.
   */
  readonly mode: AppearanceMode;
  readonly font: string;
  readonly density: Density;
  readonly fonts: readonly FontChoice[];
  readonly brandName: string;
  readonly brandLogoSrc: string | undefined;
  readonly secureCookies: boolean;
  /**
   * The appearance form's no-JS return address has to carry the environment prefix, or
   * a non-prod respondent who picks a font lands on `prod`'s copy of their page (Q21).
   */
  readonly basePath: string;
}

const AppearanceContext = createContext<AppearanceState | null>(null);

export function AppearanceProvider({
  value,
  children,
}: {
  readonly value: AppearanceState;
  readonly children: ReactNode;
}) {
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

/**
 * Nullable rather than throwing, because the consumers are page chrome: a header that
 * threw would turn a missing provider into a blank page for a respondent mid-form.
 */
export function useAppearance(): AppearanceState | null {
  return useContext(AppearanceContext);
}
