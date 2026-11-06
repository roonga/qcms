"use client";

import { useEffect, useState, type ReactNode } from "react";

export function RailDisclosure({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const [ready, setReady] = useState(false);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 64rem)");
    const sync = (): void => {
      setPinned(query.matches);
      // Recompute the default only when crossing the responsive boundary; ordinary rerenders must preserve the
      // reader's toggle.
      setOpen(query.matches);
      setReady(true);
    };
    sync();
    query.addEventListener("change", sync);
    return () => {
      query.removeEventListener("change", sync);
    };
  }, []);

  return (
    <details
      className="qcms-rail__disclosure"
      open={open}
      // Preserve the user's disclosure choice across builder rerenders; recomputing it on every edit would close
      // the rail.
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
      // Preventing the summary click also covers Enter and Space, whose native action dispatches click. Only this
      // disclosure own summary: nested accordions inside the rail must still toggle.
      onClickCapture={(event) => {
        if (!pinned) return;
        const summary = (event.target as HTMLElement).closest("summary");
        if (summary?.parentElement === event.currentTarget) event.preventDefault();
      }}
      {...(ready ? { "data-ready": "" } : {})}
    >
      {children}
    </details>
  );
}
