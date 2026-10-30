"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** How long a tooltip outlives the pointer leaving it, so a diagonal path does not close it. */
const HOVER_CLOSE_DELAY_MS = 200;

/**
 * A small icon button with a visible tooltip, for the assistant panel's header.
 *
 * A bare `<button>` rather than the kit's, for the reason `public-form-link.tsx` gives:
 * the kit's `Button` takes no `aria-label`, and an icon-only control needs one. The
 * accessible name is the label; the tooltip repeats it for sighted pointer and keyboard
 * users and is hidden from assistive technology so it is not read twice.
 *
 * ## WCAG 2.2 SC 1.4.13, and what each half of it costs
 *
 * - **Hoverable.** The tooltip is a descendant of the hovered wrapper, and its own box
 *   starts flush with the button's bottom edge: the visible bubble is offset inside it
 *   by padding, so there is no strip between the two where the pointer is over neither.
 *   A short close delay covers the pointer leaving at a corner on its way across.
 * - **Dismissible.** Escape closes it wherever keyboard focus is, not only on the
 *   button: while a tooltip is open, a document listener watches for Escape and is
 *   removed again when it closes. The key is never consumed, so a host that gives Escape
 *   a meaning of its own still sees it; keeping focus still is the host's part, and the
 *   assistant dock's handler holds off while a tooltip is in the document.
 * - **Persistent.** It stays until the pointer and focus have both left, or Escape.
 *
 * The target is 28 CSS px, above SC 2.5.8's 24px floor. Geometry and Escape are proven
 * in a real browser by `e2e/agent-assist.pw.ts`, because jsdom has no layout.
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
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const open = (hovered || focused) && !dismissed;

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      clearTimeout(closeTimer.current);
    };
  }, []);

  return (
    <span
      className="qcms-assist-iconbtn"
      onMouseEnter={() => {
        clearTimeout(closeTimer.current);
        if (!hovered) setDismissed(false);
        setHovered(true);
      }}
      onMouseLeave={() => {
        clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(() => {
          setHovered(false);
        }, HOVER_CLOSE_DELAY_MS);
      }}
    >
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
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) setDismissed(true);
        }}
      >
        <span aria-hidden="true" className="qcms-assist-iconbtn__icon">
          {children}
        </span>
      </button>
      {open && (
        <span aria-hidden="true" className="qcms-assist-iconbtn__tip" data-testid="qcms-assist-tip">
          <span className="qcms-assist-iconbtn__bubble">{label}</span>
        </span>
      )}
    </span>
  );
}
