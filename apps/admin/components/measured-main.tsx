"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { mainClassFor } from "@/lib/measure";

export function MeasuredMain({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  return (
    <main id="main-content" className={mainClassFor(pathname)}>
      {children}
    </main>
  );
}
