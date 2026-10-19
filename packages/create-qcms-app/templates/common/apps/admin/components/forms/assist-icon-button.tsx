"use client";

import { useState, type ReactNode } from "react";

/**
 * A small icon button with a visible tooltip, for the assistant panel's header.
 *
 * A bare `<button>` rather than the kit's, for the reason `public-form-link.tsx` gives:
 * the kit's `Button` takes no `aria-label`, and an icon-only control needs one. The
 * accessible name is the label; the tooltip repeats it for sighted pointer and keyboard
 * users and is hidden from assistive technology so it is not read twice.
 *
 * The tooltip meets WCAG 2.2 SC 1.4.13: it shows on hover and on focus, stays while the
 * pointer moves onto it (it sits inside the hovered wrapper), and Escape dismisses it
 * without moving focus. The target is 28 CSS px, above SC 2.5.8's 24px floor.
 */
export function AssistIconButton({
  label,
  onPress,
  isDisabled = false,
  expanded,
  controls,
  testId,
  children,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly isDisabled?: boolean;
  /** For a disclosure toggle: whether what it controls is open. */
  readonly expanded?: boolean;
  readonly controls?: string;
  readonly testId?: string;
  /** The icon. Decorative: it is rendered `aria-hidden`. */
  readonly children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed;

  return (
    <span
      className="qcms-assist-iconbtn"
      onMouseEnter={() => {
        setHovered(true);
        setDismissed(false);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
    >
      <button
        type="button"
        className="qcms-assist-iconbtn__button"
        aria-label={label}
        aria-expanded={expanded}
        aria-controls={controls}
        disabled={isDisabled}
        data-testid={testId}
        onClick={onPress}
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setDismissed(true);
          }
        }}
      >
        <span aria-hidden="true" className="qcms-assist-iconbtn__icon">
          {children}
        </span>
      </button>
      {open && (
        <span aria-hidden="true" className="qcms-assist-iconbtn__tip" data-testid="qcms-assist-tip">
          {label}
        </span>
      )}
    </span>
  );
}
