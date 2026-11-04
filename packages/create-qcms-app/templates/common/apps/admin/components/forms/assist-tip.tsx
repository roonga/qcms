"use client";

import { useEffect, useRef, useState } from "react";

const HOVER_CLOSE_DELAY_MS = 200;

/* Do not consume Escape: a containing widget may also own it; the assistant dock defers while this tip
   exists. */
export function useAssistTip(): {
  readonly open: boolean;
  readonly dismiss: () => void;
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
    dismiss: () => {
      setDismissed(true);
    },
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

export function AssistTip({ text }: { readonly text: string }) {
  return (
    <span aria-hidden="true" className="qcms-assist-iconbtn__tip" data-testid="qcms-assist-tip">
      <span className="qcms-assist-iconbtn__bubble">{text}</span>
    </span>
  );
}
