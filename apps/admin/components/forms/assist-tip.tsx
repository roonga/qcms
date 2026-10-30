"use client";

import { useEffect, useRef, useState } from "react";

/** How long a tooltip outlives the pointer leaving it, so a diagonal path does not close it. */
const HOVER_CLOSE_DELAY_MS = 200;

/**
 * The assistant's tooltip: dismissible, hoverable and persistent (WCAG 2.2 SC 1.4.13).
 *
 * - **Hoverable.** The tip is a descendant of the hovered wrapper and its box starts flush
 *   with the control's bottom edge: the visible bubble is offset inside it by padding, so
 *   there is no strip where the pointer is over neither. A short close delay covers the
 *   pointer leaving at a corner on its way across.
 * - **Dismissible.** Escape closes it wherever keyboard focus is, so a document listener
 *   runs while one is open. The key is never consumed, so a host that gives Escape a
 *   meaning of its own still sees it; the assistant dock's handler holds off while a tip
 *   is in the document.
 * - **Persistent.** It stays until the pointer and focus have both left, or Escape.
 *
 * Shared by the panel's icon buttons and the top bar's 32px assistant button, so one
 * implementation carries the criterion for both.
 */
export function useAssistTip(): {
  readonly open: boolean;
  readonly hover: {
    readonly onMouseEnter: () => void;
    readonly onMouseLeave: () => void;
  };
  readonly control: {
    readonly onFocus: () => void;
    readonly onBlur: () => void;
    readonly onKeyDown: (event: { readonly key: string }) => void;
  };
} {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const open = (hovered || focused) && !dismissed;

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      clearTimeout(closeTimer.current);
    };
  }, []);

  return {
    open,
    hover: {
      onMouseEnter: () => {
        clearTimeout(closeTimer.current);
        if (!hovered) setDismissed(false);
        setHovered(true);
      },
      onMouseLeave: () => {
        clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(() => {
          setHovered(false);
        }, HOVER_CLOSE_DELAY_MS);
      },
    },
    control: {
      onFocus: () => {
        setFocused(true);
        setDismissed(false);
      },
      onBlur: () => {
        setFocused(false);
      },
      onKeyDown: (event) => {
        if (event.key === "Escape" && open) setDismissed(true);
      },
    },
  };
}

/** The bubble. Hidden from assistive technology: the control's own name says the same. */
export function AssistTip({ text }: { readonly text: string }) {
  return (
    <span aria-hidden="true" className="qcms-assist-iconbtn__tip" data-testid="qcms-assist-tip">
      <span className="qcms-assist-iconbtn__bubble">{text}</span>
    </span>
  );
}
