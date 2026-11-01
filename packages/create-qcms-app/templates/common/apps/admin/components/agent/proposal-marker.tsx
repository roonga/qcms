"use client";

import { useEffect, useId } from "react";

import { AssistMark } from "@/components/forms/assist-mark";
import { t } from "@/lib/i18n/en";

/**
 * The marker that sits before the heading-row control a waiting card's first not-yet-run
 * step mirrors. Activating it moves focus to the card and sends nothing: it is never a
 * second Confirm. Words plus an icon, and a dashed outline on the mirrored control, so
 * neither signal is colour alone.
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
        {/* The mark is named "Assistant", so the link reads "Assistant proposed · Review". */}
        <AssistMark size={16} />
        {t("agent.marker.text")}
      </a>
      <span className="qcms-visually-hidden" id={descriptionId}>
        {t("agent.marker.description", { summary: props.summary })}
      </span>
    </>
  );
}
