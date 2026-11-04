"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { useProposalMarker } from "@/lib/agent/waiting";

import { ProposalMarker } from "./proposal-marker";

const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  '[role="button"]',
].join(",");

export function HeadingMarker({
  control,
  block,
  children,
}: {
  readonly control: string | readonly string[];
  readonly block?: boolean;
  readonly children: ReactNode;
}) {
  const binding = useProposalMarker(typeof control === "string" ? [control] : control);
  const slot = useRef<HTMLSpanElement>(null);
  const target = useRef<HTMLElement | null>(null);
  const [found, setFound] = useState(false);

  useEffect(() => {
    target.current = slot.current?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
    setFound(target.current !== null);
  }, [children]);

  return (
    <span className="qcms-pmark__group" data-block={block === true ? "true" : undefined}>
      {binding === undefined || !found ? null : (
        <ProposalMarker
          cardId={binding.cardId}
          summary={binding.summary}
          controlRef={target}
          onReview={binding.onReview}
        />
      )}
      <span className="qcms-pmark__slot" ref={slot}>
        {children}
      </span>
    </span>
  );
}
