"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { t } from "@/lib/i18n/en";

const GUTTER = 8;
const GAP = 6;

/* Help that is worth keeping but not worth a line of its own: a "?" that opens on hover, focus or tap. */
export function HelpTip({ children }: { readonly children: ReactNode }) {
  const id = useId();
  const [isOpen, setOpen] = useState(false);
  const [spot, setSpot] = useState<{ readonly top: number; readonly left: number } | undefined>(
    undefined,
  );
  const root = useRef<HTMLSpanElement>(null);
  const body = useRef<HTMLSpanElement>(null);

  /* The tip is placed against the viewport, not the button: an absolute box would widen the document
     even while hidden, and a tip wider than the space beside the button would be cut off. */
  useLayoutEffect(() => {
    if (!isOpen) return;
    const anchor = root.current?.getBoundingClientRect();
    const tip = body.current;
    if (anchor === undefined || tip === null) return;
    const viewport = document.documentElement.clientWidth;
    const width = Math.min(tip.offsetWidth, viewport - GUTTER * 2);
    const left = Math.min(Math.max(anchor.left, GUTTER), viewport - GUTTER - width);
    setSpot({ top: anchor.bottom + GAP, left });
  }, [isOpen]);

  const hide = (): void => {
    setOpen(false);
  };

  return (
    <span
      ref={root}
      className="qcms-helptip"
      onPointerEnter={() => {
        setOpen(true);
      }}
      onPointerLeave={() => {
        if (root.current?.contains(document.activeElement) !== true) hide();
      }}
      onFocus={() => {
        setOpen(true);
      }}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !isOpen) return;
        event.stopPropagation();
        hide();
      }}
    >
      <button
        type="button"
        className="qcms-helptip__button"
        aria-label={t("help.label")}
        aria-describedby={id}
        aria-expanded={isOpen}
        onClick={() => {
          setOpen(!isOpen);
        }}
      >
        ?
      </button>
      <span
        ref={body}
        role="tooltip"
        id={id}
        className="qcms-helptip__body"
        data-open={isOpen ? "true" : "false"}
        {...(spot === undefined ? {} : { style: { top: spot.top, left: spot.left } })}
      >
        {children}
      </span>
    </span>
  );
}

/* A field whose help is a rule rather than a format: the "?" sits on the label line beside it. */
export function FieldHelp({
  help,
  children,
}: {
  readonly help: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="qcms-field-help">
      {children}
      <HelpTip>{help}</HelpTip>
    </div>
  );
}
