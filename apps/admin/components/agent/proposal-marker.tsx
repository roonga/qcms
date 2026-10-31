"use client";

import { useEffect, useId } from "react";

import { AssistMark } from "@/components/forms/assist-mark";
import { t } from "@/lib/i18n/en";

/**
 * The heading-row proposal marker (083 D0, review suggestion S8; Code Owner,
 * 2026-10-24).
 *
 * It sits immediately before the heading-row control that a waiting card's first
 * not-yet-run step mirrors, and it is **presentational only**: activating it moves focus
 * to the card's heading and sends nothing. Pressing the heading-row control itself
 * behaves exactly as it does without a card, because the card is not a shortcut through
 * the screen's dialog and the dialog is not a way to confirm the card.
 *
 * It carries words and an icon, and the mirrored control gains a dashed outline rather
 * than a tint, so neither signal is colour alone. The outline takes no layout space, so
 * nothing moves when the marker appears or clears. It clears as soon as the card leaves
 * the Proposed state.
 */

export interface ProposalMarkerProps {
  /** The waiting card's heading id; the marker's own `href` target. */
  readonly cardId: string;
  /** The card's title, for the description that says what the marker opens. */
  readonly summary: string;
  /** The heading-row control to outline. */
  readonly controlRef: React.RefObject<HTMLElement | null>;
  /** Opens the panel if it is closed, then focuses the card's heading. */
  readonly onReview: () => void;
}

export function ProposalMarker(props: ProposalMarkerProps): React.ReactElement {
  const descriptionId = useId();
  const { controlRef } = props;

  useEffect(() => {
    const control = controlRef.current;
    if (control === null) return undefined;
    control.dataset["proposed"] = "true";
    return () => {
      delete control.dataset["proposed"];
    };
  }, [controlRef]);

  return (
    <>
      <a
        className="qcms-pmark"
        href={`#${props.cardId}`}
        aria-describedby={descriptionId}
        onClick={(event) => {
          event.preventDefault();
          props.onReview();
        }}
      >
        {/* The mark replaces the word "Assistant" and is named it, so the link reads
            "Assistant proposed · Review" (Code Owner, 2026-10-24, issue #1129). */}
        <AssistMark size={16} />
        {t("agent.marker.text")}
      </a>
      <span className="qcms-visually-hidden" id={descriptionId}>
        {t("agent.marker.description", { summary: props.summary })}
      </span>
    </>
  );
}
