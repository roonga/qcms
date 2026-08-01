"use client";

import { useEffect, useState } from "react";

import { MenuItem, MenuList, MenuPopover, MenuTrigger, MenuTriggerButton } from "@/components/kit";
import { ModeGlyph } from "@/components/mode-glyph";
import { MODES, modeCookie, type Mode } from "@/lib/appearance";
import { t } from "@/lib/i18n/en";

/**
 * The operator's colour-mode control (task 055; rebuilt as a menu by task 032).
 *
 * The mechanism is unchanged from 055 and deliberately so: swap one root class,
 * write one long-lived cookie, in that order and with no round trip. The class swap
 * is what the operator sees immediately; the cookie is what makes the NEXT server
 * render already correct, so a navigation, a reload or a fresh sign-in never flashes
 * back. Nothing here knows a single colour - the token contract does the rest.
 *
 * WHAT 032 CHANGED, AND WHY
 * The three-chip radio group read as three buttons competing with the nav in a bar
 * that also has to hold an account control (Code Owner call, 2026-07-31, recorded in
 * `plan/admin-theme/ds-navbar.html`). It is now one 32px icon-only trigger: no text,
 * no caret, and no border or fill at rest, so the glyph alone is the button and the
 * box materializes under hover or while the menu is open. High contrast keeps a
 * permanent border, which is a deliberate exception rather than an oversight - a
 * borderless icon is exactly what an operator in that mode struggles to find.
 *
 * The word the trigger dropped is not lost: it is the accessible name ("Appearance:
 * Dark"), and it is every menu row's own label. A screen reader hears more than
 * before, not less.
 *
 * HIGH-CONTRAST IS ONLY EVER EXPLICIT
 * Nothing infers it. The token sheet's auto block covers `prefers-color-scheme` only
 * and has no `prefers-contrast` companion, and this control never resolves to `hc`
 * on its own: `hc` appears exactly when the operator has chosen it or the cookie
 * says they did. High-contrast changes far more than a palette, and inferring it
 * from a signal the operating system sends for other reasons would take the choice
 * away.
 *
 * THE STARTING SELECTION
 * The server passes the cookie's mode, or `undefined` when there is none. With none,
 * the page is being painted by the sheet's OS-following block, so the control asks
 * the browser the same question the sheet asked and shows the answer. That read runs
 * in an effect rather than during render, because `matchMedia` does not exist during
 * SSR and a first render that disagreed with the server's HTML is a hydration
 * mismatch. It corrects the CONTROL only: the page itself was already painted right.
 *
 * WHY `onAction` AND NOT `onSelectionChange`
 * The same reason 055's chips carried `onClick` beside `onChange`. Choosing the mode
 * you are already in has to DO something when no cookie exists yet: that is the
 * "keep Light even when my machine goes dark" opt-out, and it is the whole reason
 * Light is a real selection rather than an absence. A selection callback fires on
 * change, and there is no change to report. `onAction` fires on every activation,
 * and the work it does is idempotent, so it is correct in both cases.
 * `selectionMode`/`selectedKeys` stay, because they are what give each row
 * `role="menuitemradio"` and `aria-checked` - the semantics, not the wiring.
 *
 * WITHOUT JAVASCRIPT the whole control is hidden (the `<noscript>` rule in
 * `app/layout.tsx`), because a menu an operator can focus but not open is worse than
 * no control at all. The OS-following default still applies, and it is a server
 * render, so a no-JS operator still gets a correct page. Sign-out is the case that
 * does NOT get this treatment: see `account-menu.tsx`.
 */

/** The check glyph on the chosen row. U+2713. */
const SELECTED_MARK = "✓";

export function AppearanceMenu({
  mode,
  secureCookies,
}: {
  /** The operator's stored choice, or `undefined` when they have not made one. */
  readonly mode: Mode | undefined;
  readonly secureCookies: boolean;
}) {
  const [selected, setSelected] = useState<Mode>(mode ?? "light");

  useEffect(() => {
    if (mode !== undefined) return;
    setSelected(globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, [mode]);

  const choose = (next: Mode): void => {
    setSelected(next);
    const root = document.documentElement;
    for (const candidate of MODES) root.classList.remove(candidate);
    root.classList.add(next);
    document.cookie = modeCookie(next, secureCookies);
  };

  return (
    <div className="qcms-appearance" data-testid="appearance-menu">
      <MenuTrigger>
        <MenuTriggerButton
          className="qcms-modetrigger"
          aria-label={t("appearance.trigger", { mode: t(`appearance.mode.${selected}`) })}
        >
          <ModeGlyph mode={selected} />
        </MenuTriggerButton>
        <MenuPopover className="qcms-menu">
          <MenuList
            className="qcms-menu__list"
            aria-label={t("appearance.mode.legend")}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[selected]}
            onAction={(key) => {
              const next = MODES.find((candidate) => candidate === key);
              if (next !== undefined) choose(next);
            }}
          >
            {MODES.map((value) => (
              <MenuItem
                key={value}
                id={value}
                className="qcms-menu__item"
                textValue={t(`appearance.mode.${value}`)}
              >
                {/* Never colour alone (WCAG 1.4.1): the glyph, the weight and the
                    inset accent edge in the stylesheet each carry the checked state
                    on their own. The mark is decorative - `aria-checked` is what a
                    screen reader hears - and the span keeps its width either way, so
                    choosing a row moves no text. */}
                <span className="qcms-menu__check" aria-hidden="true">
                  {value === selected ? SELECTED_MARK : ""}
                </span>
                {t(`appearance.mode.${value}`)}
              </MenuItem>
            ))}
          </MenuList>
        </MenuPopover>
      </MenuTrigger>
    </div>
  );
}
