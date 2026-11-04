"use client";

import { useEffect, useId } from "react";

import { AssistMark } from "@/components/forms/assist-mark";
import { t } from "@/lib/i18n/en";

/* The marker only focuses the existing card; activating it must never confirm a proposal. */

export interface ProposalMarkerProps {
  readonly cardId: string;
  readonly summary: string;
  readonly controlRef: React.RefObject<HTMLElement | null>;
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
        <AssistMark size={16} />
        {t("agent.marker.text")}
      </a>
      <span className="qcms-visually-hidden" id={descriptionId}>
        {t("agent.marker.description", { summary: props.summary })}
      </span>
    </>
  );
}
