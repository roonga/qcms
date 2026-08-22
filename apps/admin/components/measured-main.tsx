"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { measureClassFor } from "@/lib/measure";

/**
 * The shell's content column, capped by the route it is showing (issue 558).
 *
 * A client component for exactly one reason, and it is the same reason `AdminNav` is one:
 * a Next layout wraps the page tree and is never told which child route rendered, so a
 * decision made per route has to be taken where the pathname is readable. `usePathname`
 * is readable during the SERVER render of a client component too, so the cap is in the
 * first HTML the browser parses. Nothing here waits for hydration, nothing changes on
 * hydration, and a screen with JavaScript disabled is capped exactly the same - which
 * matters, because every authenticated screen in this app works without it.
 *
 * The component owns no width of its own. It asks `lib/measure.ts` and renders what it is
 * given, so the sixteen answers stay in one table rather than becoming a condition here.
 *
 * WHY THE TOPBAR AND FOOTER DO NOT FOLLOW. They keep the shell's own `max-w-5xl`.
 * `plan/admin-ux-audit.md` §6 is a question about the content column ("roughly 976px of
 * content after `p-6`"), and the two are separable: the topbar is chrome with its own
 * design card and its own wrapping behaviour, and it is what issue 559's rail replaces.
 * Tying it to the route cap would also make the bar reflow on navigation - narrower on
 * the two preview screens, where five nav items plus the trailing controls would begin to
 * wrap - which is a worse outcome than chrome and content having different measures.
 */
export function MeasuredMain({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  // Composed in this order so the nine unchanged screens keep the exact class attribute
  // they had before the table existed: `mx-auto w-full max-w-5xl flex-1 p-6`.
  return (
    <main id="main-content" className={`mx-auto w-full ${measureClassFor(pathname)} flex-1 p-6`}>
      {children}
    </main>
  );
}
