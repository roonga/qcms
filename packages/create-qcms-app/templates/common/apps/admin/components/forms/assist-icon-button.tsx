"use client";

import type { ReactNode } from "react";

import { AssistTip, useAssistTip } from "./assist-tip";

/**
 * A small icon button with a visible tooltip, for the assistant panel's header.
 *
 * A bare `<button>` rather than the kit's, for the reason `public-form-link.tsx` gives:
 * the kit's `Button` takes no `aria-label`, and an icon-only control needs one. The
 * accessible name is the label; the tooltip repeats it for sighted pointer and keyboard
 * users and is hidden from assistive technology so it is not read twice.
 *
 * The tooltip's three SC 1.4.13 properties live in `assist-tip.tsx`, which the top bar's
 * assistant button shares. The target is 28 CSS px, above SC 2.5.8's 24px floor. Geometry
 * and Escape are proven in a real browser by `e2e/agent-assist.pw.ts`, because jsdom has
 * no layout.
 */
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
  /** For a disclosure toggle: whether what it controls is open. */
  readonly expanded?: boolean;
  /** For a state toggle, such as the assistant's Expand control: whether it is on. */
  readonly pressed?: boolean;
  readonly controls?: string;
  readonly testId?: string;
  /** The icon. Decorative: it is rendered `aria-hidden`. */
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
