"use client";

import { useId, useRef, useState, type ReactNode } from "react";

import { t } from "@/lib/i18n/en";

/* Help that is worth keeping but not worth a line of its own: a "?" that opens on hover, focus or tap. */
export function HelpTip({ children }: { readonly children: ReactNode }) {
  const id = useId();
  const [isOpen, setOpen] = useState(false);
  const [alignToEnd, setAlignToEnd] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const body = useRef<HTMLSpanElement>(null);

  /* The tip is as wide as its text and starts at the button, so only the inline-end edge can clip it.
     A hidden tip still has layout, so this measures before the first paint rather than after. */
  const show = (): void => {
    setOpen(true);
    const left = root.current?.getBoundingClientRect().left;
    const width = body.current?.offsetWidth;
    if (left !== undefined && width !== undefined) {
      setAlignToEnd(left + width > document.documentElement.clientWidth);
    }
  };

  const hide = (): void => {
    setOpen(false);
  };

  return (
    <span
      ref={root}
      className="qcms-helptip"
      onPointerEnter={show}
      onPointerLeave={() => {
        if (root.current?.contains(document.activeElement) !== true) hide();
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
        type="button"
        className="qcms-helptip__button"
        aria-label={t("help.label")}
        aria-describedby={id}
        aria-expanded={isOpen}
        onClick={() => {
          if (isOpen) {
            hide();
            return;
          }
          show();
        }}
      >
        ?
      </button>
      <span
        ref={body}
        role="tooltip"
        id={id}
        className={alignToEnd ? "qcms-helptip__body qcms-helptip__body--end" : "qcms-helptip__body"}
        data-open={isOpen ? "true" : "false"}
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
