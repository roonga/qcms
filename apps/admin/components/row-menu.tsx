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
/**
 * The items arrow keys may land on.
 *
 * Every query in here filters disabled items out, and that is load-bearing rather than
 * tidy: a disabled `<button>` cannot take focus at all, so `.focus()` on one is a silent
 * no-op. An unfiltered roving list therefore dead-ends the moment a disabled item sits
 * between two live ones - arrowing onto it does nothing, and the next press recomputes
 * the same index and does nothing again. Everything past it is unreachable by keyboard.
 *
 * Item ORDER is the caller's, so this component cannot assume disabled items sit at one
 * end. Both callers now put Move up and Move down in the middle of five items and disable
 * them at the ends of the list: the pin list from the start (issue 517), the option grid
 * since issue 680 gave it the same pair. Without this filter, the first row of every step
 * and of every option list loses Move down and Remove, and a single-row one loses Remove
 * entirely. Filtering here keeps the menu sound for any item order a future caller picks,
 * rather than making "disabled items last" an unwritten rule the callers happen to follow -
 * which is what the option grid's own menu looked like until 680, and why the defect 517
 * fixed stayed latent there.
 *
 * ## `disabled` rather than `aria-disabled`
 *
 * The items are natively `disabled`. That is the honest mapping of "this action does not
 * exist for this row" and needs no ARIA override (ADR-22 prefers native semantics), and
 * the item stays in the accessibility tree with its disabled state, so a screen reader
 * reading the menu container still finds and announces it as unavailable.
 *
 * The APG menu pattern does allow the other choice: keep disabled items focusable with
 * `aria-disabled="true"` so arrow keys land on them and the reason ("Move up, unavailable")
 * is spoken during roving. That is a genuine discoverability gain and a genuine change of
 * behaviour for every caller, so it is not made here: with native `disabled` there is no
 * "focus it and refuse to activate" option, only skip, and skipping is what makes the
 * items behind it reachable at all.
 */
const FOCUSABLE_ITEM = "[role='menuitem']:not([disabled])";

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
    menuRef.current?.querySelector<HTMLElement>(FOCUSABLE_ITEM)?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const entries = [...(menuRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_ITEM) ?? [])];
    if (entries.length === 0) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    const here = entries.indexOf(document.activeElement as HTMLElement);
    // Focus is somewhere outside the live set (the open effect found nothing to take it,
    // or a caller moved it): enter at the top going down and at the bottom going up,
    // which is APG's entry behaviour rather than a wrap computed off index -1.
    if (here === -1) {
      entries[step === 1 ? 0 : entries.length - 1]?.focus();
      return;
    }
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
