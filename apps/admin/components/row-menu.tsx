"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

/**
 * The row grip menu (design-language element 5), as ONE implementation.
 *
 * It was written for the option grid in task 057, straight from the frozen card
 * `plan/admin-theme/ds-option-grid.html`. Issue 517 applies the same pattern to the step
 * editor's pin list, so it moves here rather than being copied: a house pattern with two
 * implementations is how the app grew the three table treatments issue 514 had to
 * reconcile, and the point of the redesign is to stop doing that.
 *
 * ## Why it is hand-rolled rather than the vendored `MenuTrigger` (ADR-22)
 *
 * The grip is more than one control. On the option grid it is drag-to-reorder,
 * Arrow Up/Down to reorder by keyboard, and Enter or Space to open this menu.
 * react-aria's `useMenuTrigger` opens on press **start**, which is correct for a menu
 * button and wrong for a handle: the menu would spring open the instant a pointer
 * grabbed it to drag. There is no prop that defers it, so the menu is written against
 * the APG menu pattern directly (focus moves in on open, the arrow keys rove, Escape
 * and Tab close and hand focus back to the grip).
 *
 * That is one bespoke widget in app code, not a second component library, so ADR-22's
 * single-stack rule holds: nothing else in either caller is hand-made, and anything
 * reusable beyond this app belongs upstream in a2-react-aria rather than here.
 *
 * ## What a caller owns
 *
 * The trigger, its `aria-haspopup="menu"`/`aria-expanded` pair, the positioned cell this
 * renders inside (the menu is `position: absolute`, so the trigger's cell must be the
 * containing block), and closing on an outside press. This owns only the popup: its
 * roving focus, its escape hatches, and its items.
 *
 * Every item's label names its row ("Insert above Roadside assistance", "Move q_notes
 * up"). Two rows' menus are otherwise indistinguishable from each other, which is a
 * screen-reader user hearing the same three or five words wherever they are.
 */
export interface RowMenuItem {
  /** Stable within one menu; used as the React key, never shown. */
  readonly key: string;
  readonly label: string;
  readonly isDisabled?: boolean | undefined;
  /** Destructive items take the danger colour. */
  readonly isDanger?: boolean | undefined;
  readonly onSelect: () => void;
}

export function RowMenu({
  menuLabel,
  items,
  onClose,
}: {
  readonly menuLabel: string;
  readonly items: readonly RowMenuItem[];
  readonly onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus the first item that can actually take it: an APG menu owns focus while it is
  // open, and opening onto a disabled item strands a keyboard operator on a dead target.
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>("[role='menuitem']:not([disabled])")?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const entries = [
      ...(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? []),
    ];
    const here = entries.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    entries[(here + step + entries.length) % entries.length]?.focus();
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={menuLabel}
      className="qcms-rowmenu"
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          data-row-menu-item={item.key}
          className={
            item.isDanger === true
              ? "qcms-rowmenu__item qcms-rowmenu__item--danger"
              : "qcms-rowmenu__item"
          }
          disabled={item.isDisabled === true}
          onClick={item.onSelect}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
