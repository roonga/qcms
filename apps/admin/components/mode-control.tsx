"use client";

import { useEffect, useState } from "react";

import { MODES, modeCookie, type Mode } from "@/lib/appearance";
import { t } from "@/lib/i18n/en";

/**
 * The operator's colour-mode control (task 055): light, dark, high-contrast.
 *
 * WHAT IT DOES
 * Swaps one root class and writes one long-lived cookie, in that order and with no
 * round trip. The class swap is what the operator sees immediately; the cookie is
 * what makes the NEXT server render already correct, so a navigation, a reload or a
 * fresh sign-in never flashes back. The token contract does the rest, so nothing
 * here knows a single colour.
 *
 * HIGH-CONTRAST IS ONLY EVER EXPLICIT
 * Nothing infers it. The token sheet's auto block covers `prefers-color-scheme` only
 * and has no `prefers-contrast` companion, and this control never resolves to `hc`
 * on its own: `hc` appears exactly when the operator has chosen it or the cookie
 * says they did. That is a deliberate constraint of the design, not an omission -
 * high-contrast changes far more than a palette, and inferring it from a signal the
 * operating system sends for other reasons would take the choice away.
 *
 * THE STARTING SELECTION
 * The server passes the cookie's mode, or `undefined` when there is none. With none,
 * the page is being painted by the sheet's OS-following block, so the control asks
 * the browser the same question the sheet asked and shows the answer. That read runs
 * in an effect rather than during render, because `matchMedia` does not exist during
 * SSR and a first render that disagreed with the server's HTML is a hydration
 * mismatch. It corrects the CONTROL only: the page itself was already painted right.
 *
 * WITHOUT JAVASCRIPT the whole control is hidden (the `<noscript>` rule in
 * `app/layout.tsx`), because a radio an operator can move that changes nothing is
 * worse than no control at all. The OS-following default still applies, and it is a
 * server render, so a no-JS operator still gets a correct page.
 */

/** The check glyph on the selected chip. U+2713. */
const SELECTED_MARK = "✓";

export function ModeControl({
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
    <fieldset className="qcms-mode" data-testid="mode-control">
      <legend className="qcms-mode__legend">{t("appearance.mode.legend")}</legend>
      <div className="qcms-mode__row">
        {MODES.map((value) => {
          const isSelected = value === selected;
          return (
            <label
              key={value}
              className="qcms-mode__chip"
              data-selected={isSelected ? "true" : "false"}
              data-value={value}
            >
              {/* `onClick` as well as `onChange`, and not by accident: a radio that
                  is already checked fires no change event, so without this the one
                  choice an operator cannot make is the mode they are already looking
                  at - which is exactly the "keep Light even when my machine goes
                  dark" opt-out this control exists to offer. Choosing twice is
                  idempotent, so the pair costs nothing when both fire. */}
              <input
                className="qcms-mode__input"
                type="radio"
                name="qcms-app-mode"
                value={value}
                checked={isSelected}
                onChange={() => {
                  choose(value);
                }}
                onClick={() => {
                  choose(value);
                }}
              />
              {/* The radio's own checked state is what conveys selection to a screen
                  reader, so the mark is decorative and announces nothing twice. */}
              <span className="qcms-mode__mark" aria-hidden="true">
                {isSelected ? SELECTED_MARK : ""}
              </span>
              <span>{t(`appearance.mode.${value}`)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
