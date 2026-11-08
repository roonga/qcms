"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { t } from "@/lib/i18n/en";

const DESKTOP_GUTTER = 8;
const PHONE_GUTTER = 16;
const PHONE_WIDTH = 640;
const GAP = 8;
const HOVER_DELAY_MS = 150;
/** Long enough to cross the gap between the glyph and the tip without closing it (WCAG 1.4.13). */
const GRACE_MS = 200;

/** One tip at a time: opening one closes whichever was open. */
let closeOpen: (() => void) | undefined;

interface Spot {
  readonly top: number;
  readonly left: number;
  readonly arrow: number;
  readonly placement: "bottom" | "top";
}

/* Help worth keeping but not worth a line of its own: a drawn "?" that opens one or two sentences on
   hover, focus or tap. */
export function HelpTip({
  children,
  label,
  size = "label",
}: {
  readonly children: ReactNode;
  /** The visible label this help belongs to, which names the button. */
  readonly label?: string;
  readonly size?: "label" | "header";
}) {
  const id = useId();
  const [isOpen, setOpen] = useState(false);
  const [spot, setSpot] = useState<Spot | undefined>(undefined);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stopTimer = useCallback((): void => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const hide = useCallback((): void => {
    stopTimer();
    setOpen(false);
  }, [stopTimer]);

  const show = useCallback((): void => {
    stopTimer();
    if (closeOpen !== undefined && closeOpen !== hide) closeOpen();
    closeOpen = hide;
    setOpen(true);
  }, [hide, stopTimer]);

  // Leaving `closeOpen` pointing at an unmounted tip's `hide` would retain its closure and make the
  // next tip close a tip that is already gone.
  useEffect(
    () => () => {
      stopTimer();
      if (closeOpen === hide) closeOpen = undefined;
    },
    [hide, stopTimer],
  );

  /* The tip is placed against the viewport, not the button: an absolute box would widen the document
     even while hidden, and a tip wider than the space beside the button would be cut off. */
  useLayoutEffect(() => {
    if (!isOpen) return;
    const anchor = button.current?.getBoundingClientRect() ?? root.current?.getBoundingClientRect();
    const tip = body.current;
    if (anchor === undefined || tip === null) return;
    const viewport = document.documentElement.clientWidth;
    const gutter = viewport < PHONE_WIDTH ? PHONE_GUTTER : DESKTOP_GUTTER;
    const width = Math.min(tip.offsetWidth, viewport - gutter * 2);
    const left = Math.min(Math.max(anchor.left - GAP, gutter), viewport - gutter - width);
    const height = tip.offsetHeight;
    const room = document.documentElement.clientHeight - anchor.bottom;
    const above = height + GAP > room && anchor.top > height + GAP;
    setSpot({
      top: above ? anchor.top - GAP - height : anchor.bottom + GAP,
      left,
      // Keep the pointer on the glyph however far the box was shifted or clamped.
      arrow: Math.max(Math.min(anchor.left + anchor.width / 2 - left - 5, width - 15), 5),
      placement: above ? "top" : "bottom",
    });
  }, [isOpen]);

  return (
    <span
      ref={root}
      className="qcms-help"
      onPointerLeave={() => {
        stopTimer();
        // A grace period, so crossing from the glyph to the tip does not close it.
        timer.current = setTimeout(() => {
          if (root.current?.contains(document.activeElement) !== true) hide();
        }, GRACE_MS);
      }}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !isOpen) return;
        event.stopPropagation();
        hide();
      }}
    >
      <button
        ref={button}
        type="button"
        className="qcms-round qcms-help__button"
        data-size={size}
        aria-label={label === undefined ? t("help.label") : t("help.named", { label })}
        aria-describedby={id}
        aria-expanded={isOpen}
        onPointerEnter={() => {
          stopTimer();
          timer.current = setTimeout(show, HOVER_DELAY_MS);
        }}
        onClick={() => {
          if (isOpen) hide();
          else show();
        }}
      >
        <HelpDisc />
      </button>
      <span
        ref={body}
        role="tooltip"
        id={id}
        className="qcms-help__tip"
        data-open={isOpen ? "true" : "false"}
        data-placement={spot?.placement ?? "bottom"}
        onPointerEnter={stopTimer}
        {...(spot === undefined
          ? {}
          : {
              style: {
                top: spot.top,
                left: spot.left,
                ["--qcms-help-arrow" as string]: `${String(spot.arrow)}px`,
              },
            })}
      >
        {children}
      </span>
    </span>
  );
}

/* Drawn rather than typed: a font "?" inside a ring is stretched into an oval by whatever row holds it. */
export function HelpDisc() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle className="qcms-help__disc" cx="8" cy="8" r="8" />
      <path className="qcms-help__mark" d="M6 6.3a2 2 0 0 1 4 .2c0 1.4-2 1.6-2 2.9" />
      <circle className="qcms-help__dot" cx="8" cy="12" r="1.05" />
    </svg>
  );
}

/* A field whose help is a rule rather than a format: the "?" sits on the label line beside it. */
export function FieldHelp({
  help,
  label,
  children,
}: {
  readonly help: ReactNode;
  readonly label?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="qcms-field-help">
      {children}
      <HelpTip {...(label === undefined ? {} : { label })}>{help}</HelpTip>
    </div>
  );
}
