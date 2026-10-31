"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { useProposalMarker } from "@/lib/agent/waiting";

import { ProposalMarker } from "./proposal-marker";

/**
 * One heading-row control, with the proposal marker before it while a card waits on this
 * screen and its first not-yet-run step mirrors this control.
 *
 * The control keeps its own behaviour: pressing it opens the screen's own dialog exactly
 * as it does with no card anywhere. The marker is a link to the card, never a second
 * Confirm.
 */

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
  /** The control names the action kinds' card templates use. */
  readonly control: string | readonly string[];
  /** For a control that is a block of its own rather than one item of a heading row. */
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
