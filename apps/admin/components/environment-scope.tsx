"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect } from "react";

import { selectionFromCookies } from "@/lib/environment";

/**
 * What the shell knows about this tab's environment, for the controls under it (local UX
 * list A1, A12).
 *
 * ## Re-read on return, when another tab switched
 *
 * The selection is a cookie every tab shares and the switcher refreshes only its own tab,
 * so a second tab goes on showing the environment it was rendered in. Every
 * environment-sensitive server action refuses that difference, which is the guarantee;
 * this is the courtesy in front of it. When the tab becomes visible again and the cookie no
 * longer says what the page was rendered from, the page is re-read, so the operator usually
 * meets the new environment before they meet a refusal. It compares the raw cookie with the
 * raw cookie the server saw, never with a resolved name, so a stale selection that resolves
 * to `prod` does not refresh on every visit.
 *
 * ## Disable while unknown
 *
 * A request that could not read the live set cannot confirm which environment it shows,
 * and its actions would be refused anyway; the controls that would issue them read
 * {@link useEnvironmentUnknown} and are disabled rather than offered to fail.
 */

const EnvironmentUnknown = createContext(false);

/** True while the shell could not confirm this tab's environment. */
export function useEnvironmentUnknown(): boolean {
  return useContext(EnvironmentUnknown);
}

export function EnvironmentScope({
  selection,
  unknown,
  children,
}: {
  /** The environment cookie as the server read it for this render, `""` for none. */
  readonly selection: string;
  readonly unknown: boolean;
  readonly children: ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    const recheck = (): void => {
      if (document.visibilityState !== "visible") return;
      if (selectionFromCookies(document.cookie) !== selection) router.refresh();
    };
    document.addEventListener("visibilitychange", recheck);
    return () => {
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [selection, router]);

  return <EnvironmentUnknown.Provider value={unknown}>{children}</EnvironmentUnknown.Provider>;
}
