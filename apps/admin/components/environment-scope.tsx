"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect } from "react";

import { selectionFromCookies } from "@/lib/environment";

/* Compare raw cookies, not resolved names, to avoid refreshing forever when a stale selection falls back
   to production. */

const EnvironmentUnknown = createContext(false);

export function useEnvironmentUnknown(): boolean {
  return useContext(EnvironmentUnknown);
}

export function EnvironmentScope({
  selection,
  unknown,
  children,
}: {
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
