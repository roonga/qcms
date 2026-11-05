"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button, Dialog } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import {
  LEAVE_EXEMPT_ATTRIBUTE,
  leaveDestination,
  leavesOperations,
  plainNavigation,
  type LeaveDestination,
} from "@/lib/shell/leave-operations";

interface PendingLeave {
  readonly href: string;
  readonly destination: LeaveDestination;
}

function areaName(destination: LeaveDestination): string {
  return destination === "elsewhere" ? t("shell.leave.area.elsewhere") : t(`nav.${destination}`);
}

/**
 * Asks before a link takes the operator out of Operations. Mounted only while the shell is
 * in Operations; the Exit control carries {@link LEAVE_EXEMPT_ATTRIBUTE} and is let through.
 */
export function LeaveOperationsGuard({ environment }: { readonly environment: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingLeave | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const stayRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    function onClick(event: MouseEvent): void {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const href = plainNavigation(
        event,
        {
          href: anchor.href,
          target: anchor.target,
          download: anchor.hasAttribute("download"),
          exempt: anchor.closest(`[${LEAVE_EXEMPT_ATTRIBUTE}]`) !== null,
        },
        window.location.origin,
      );
      if (href === undefined) return;
      const pathname = new URL(href, window.location.origin).pathname;
      if (!leavesOperations(window.location.pathname, pathname, "operations")) return;
      // Capture phase on the document, so neither Next's Link nor the browser sees the click.
      event.preventDefault();
      event.stopPropagation();
      origin.current = anchor;
      setPending({ href, destination: leaveDestination(pathname) });
    }
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  useEffect(() => {
    if (pending === null) return;
    stayRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [pending]);

  function stay(): void {
    setPending(null);
    const anchor = origin.current;
    origin.current = null;
    if (anchor === null) return;
    window.setTimeout(() => {
      if (anchor.isConnected) anchor.focus();
    }, 0);
  }

  function leave(href: string): void {
    origin.current = null;
    setPending(null);
    router.push(href);
  }

  if (pending === null) return null;

  return (
    <Dialog
      isOpen
      role="alertdialog"
      title={t("shell.leave.title")}
      onOpenChange={(isOpen) => {
        if (!isOpen) stay();
      }}
    >
      <div className="flex flex-col gap-4" data-testid="qcms-leave-operations">
        <p className="text-sm text-(--color-text)">
          {t("shell.leave.goes", { area: areaName(pending.destination) })}
        </p>
        <p className="text-sm text-(--color-text)">
          {environment === ""
            ? t("shell.leave.environmentUnknown")
            : t("shell.leave.environment", { environment })}
        </p>
        <div className="flex flex-wrap gap-2">
          <span ref={stayRef}>
            <Button variant="primary" size="md" onPress={stay}>
              {t("shell.leave.stay")}
            </Button>
          </span>
          <Button
            variant="secondary"
            size="md"
            onPress={() => {
              leave(pending.href);
            }}
          >
            {t("shell.leave.leave")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
