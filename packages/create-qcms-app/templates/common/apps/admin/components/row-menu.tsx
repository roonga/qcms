"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

/* The trigger's positioned cell must contain the absolute menu; callers own outside-click closing and a
   row-specific accessible name. */
/* Filter disabled commands before keyboard indexing so unavailable first items cannot hide reachable
   commands. */
const FOCUSABLE_ITEM = "[role='menuitem']:not([disabled])";

export interface RowMenuItem {
  readonly key: string;
  readonly label: string;
  readonly isDisabled?: boolean | undefined;
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

  // Focus the first enabled menu item so opening cannot strand keyboard focus on a disabled command.
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
