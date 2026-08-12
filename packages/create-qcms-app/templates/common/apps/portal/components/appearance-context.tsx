"use client";

/**
 * The server's appearance answer, made available to the header (task 053).
 *
 * WHY A CONTEXT AND NOT PROPS
 * The brand mark and the appearance controls both live in `PortalShell`'s header,
 * and `PortalShell` is rendered from six places - five server components and
 * `step-flow.tsx`, which is a client component. That last one is the constraint
 * that decides the shape: because a `"use client"` module imports it, `PortalShell`
 * is part of the client bundle, so it cannot import `lib/server/theme.ts` (the R2
 * import-surface test forbids exactly that, and `process.env.QCMS_PORTAL_*` would
 * not be there to read anyway). Threading the config through six call sites, one of
 * which is already a client component, would push the same problem one level out.
 *
 * So the ROOT LAYOUT - the one server component every page passes through, and the
 * one that already resolves all of this to stamp `<html class>` - publishes it once
 * here, and the header reads it. Nothing in it is secret: it is the brand name, the
 * offered font list, and the three choices already visible in the root class
 * attribute of the served HTML.
 */

import { createContext, useContext, type ReactNode } from "react";

import type { AppearanceMode, Density } from "@/lib/appearance";

/** One font the deployment offers, flattened from `@qcms/ui`'s registry entry. */
export interface FontChoice {
  readonly key: string;
  readonly label: string;
  readonly group: string;
}

export interface AppearanceState {
  /**
   * The mode the server stamped on `<html>`. `auto` never reaches here: the layout
   * resolves it to a concrete class for the first paint.
   *
   * This is the value the controls render on the server and hydrate against, and it
   * is not necessarily the mode in force: the pre-paint script can resolve a
   * different one from a `?mode=` parameter or the OS signals, after this render was
   * generated. The controls therefore re-read the live root class once on mount. See
   * `appearance-controls.tsx`.
   */
  readonly mode: AppearanceMode;
  readonly font: string;
  readonly density: Density;
  /** The curated subset this deployment offers, in registry group order. */
  readonly fonts: readonly FontChoice[];
  /** Brand name (header text and document title) and optional logo source. */
  readonly brandName: string;
  readonly brandLogoSrc: string | undefined;
  /** Whether the appearance cookies are written with `Secure` (production). */
  readonly secureCookies: boolean;
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
 * The appearance state, or `null` outside the provider.
 *
 * Nullable rather than throwing, because the consumers are page CHROME: a header
 * that threw would turn a missing provider into a blank page for a respondent
 * mid-form. The brand mark and the controls each degrade to rendering nothing
 * instead, and `layout.tsx` is the single place the provider is mounted, so the
 * null branch is unreachable in the shipped app rather than a state to design for.
 */
export function useAppearance(): AppearanceState | null {
  return useContext(AppearanceContext);
}
