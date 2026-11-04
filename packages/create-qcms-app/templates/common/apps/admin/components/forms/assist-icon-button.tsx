"use client";

import type { ReactNode } from "react";

import { AssistTip, useAssistTip } from "./assist-tip";

export function AssistIconButton({
  label,
  onPress,
  isDisabled = false,
  expanded,
  pressed,
  controls,
  testId,
  children,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly isDisabled?: boolean;
  readonly expanded?: boolean;
  readonly pressed?: boolean;
  readonly controls?: string;
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  const tip = useAssistTip();

  return (
    <span className="qcms-assist-iconbtn" {...tip.hover}>
      <button
        type="button"
        className="qcms-assist-iconbtn__button"
        aria-label={label}
        aria-expanded={expanded}
        aria-pressed={pressed}
        aria-controls={controls}
        disabled={isDisabled}
        data-testid={testId}
        onClick={onPress}
        {...tip.control}
      >
        <span aria-hidden="true" className="qcms-assist-iconbtn__icon">
          {children}
        </span>
      </button>
      {tip.open && <AssistTip text={label} />}
    </span>
  );
}
