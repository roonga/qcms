"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/* Opening a closed workspace also lands on its first section; closing an open one just collapses it. */
export function WorkspaceSummary({
  href,
  railItem,
  children,
}: {
  readonly href: string;
  readonly railItem: string;
  readonly children: ReactNode;
}) {
  const router = useRouter();
  return (
    <summary
      className="qcms-rail__link"
      data-rail-item={railItem}
      onClick={(event) => {
        const details = event.currentTarget.parentElement;
        if (details instanceof HTMLDetailsElement && !details.open) router.push(href);
      }}
    >
      {children}
    </summary>
  );
}
