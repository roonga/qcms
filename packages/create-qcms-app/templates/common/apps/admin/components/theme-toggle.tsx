"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppearanceGlyph } from "@/components/appearance-glyph";
import { RadioButton, RadioField, RadioGroup, SwitchButton, SwitchField } from "@/components/kit";
import {
  APPEARANCE_CLASSES,
  POLARITIES,
  type Appearance,
  type Polarity,
  appearanceClasses,
  modeCookie,
} from "@/lib/appearance";
import { t } from "@/lib/i18n/en";

/**
 * The operator's one appearance control: polarity (Auto, Light, Dark) crossed with high
 * contrast.
 *
 * The mechanism is the one the three-row menu used and deliberately so: swap the root
 * classes, write one long-lived cookie, in that order and with no round trip. The class
 * swap is what the operator sees immediately; the cookie is what makes the NEXT server
 * render already correct, so a navigation, a reload or a fresh sign-in never flashes
 * back. Nothing here knows a single colour - the token contract does the rest.
 *
 * WHY TWO CONTROLS RATHER THAN A LIST
 * "Light / Dark / High contrast" presents two different questions as one list, and a dark
 * field at high contrast has no row at all. Polarity and contrast are independent on the
 * platform too (`prefers-color-scheme` and `prefers-contrast` are separate media
 * features), so the control asks them separately and the sheet composes the answer.
 *
 * HIGH CONTRAST IS ONLY EVER EXPLICIT
 * Nothing infers it. The token sheet's auto blocks cover `prefers-color-scheme` only and
 * have no `prefers-contrast` companion, and this control never turns contrast on by
 * itself. High contrast changes far more than a palette, and inferring it from a signal
 * the operating system sends for other reasons would take the choice away.
 *
 * AUTO IS A REAL SELECTION, AND SO IS LIGHT
 * Auto writes a cookie whose polarity carries no root class, which is the same page the
 * sheet paints with no cookie at all - but it records that the operator asked for it, so
 * a later change of mind is a change rather than a reset. Light is the opt-out: it
 * carries no values either, and exists only so an operator who wants Light on a
 * dark-preferring machine can stay there when the machine flips at sunset.
 *
 * THE RESOLVED POLARITY IS READ AFTER MOUNT
 * `matchMedia` does not exist during SSR, and a first render that disagreed with the
 * server's HTML is a hydration mismatch. The effect below corrects the CONTROL's wording
 * only: the page itself was already painted right by the sheet.
 *
 * THE PANEL IS ANCHORED BY CSS, NOT BY AN OVERLAY ENGINE
 * The controls inside it are react-aria's (ADR-22), but the popup is this app's own
 * absolutely positioned box under the trigger. react-aria's `Popover` closes itself on
 * any scroll event reaching the trigger, including the zero-delta one the browser fires
 * when it scrolls a freshly focused panel into view past `scroll-padding-block-start` -
 * so the panel shut again in the same frame it opened, in every high-contrast state. The
 * trigger has one fixed home in the topbar's trailing group, so there is no collision
 * geometry worth an engine, and open, dismiss and focus return are the four lines below.
 *
 * WITHOUT JAVASCRIPT there is no page for this control to be on: the admin requires
 * scripting and stops at one message without it (`app/layout.tsx`). The appearance still
 * paints correctly from the token sheet's own `prefers-color-scheme` blocks with no
 * client code involved.
 */

/** The check mark on the current preview tile. U+2713. */
const SELECTED_MARK = "✓";

const PREVIEW_STATES: readonly { readonly state: string; readonly value: Appearance }[] = [
  { state: "light", value: { polarity: "light", contrast: "normal" } },
  { state: "dark", value: { polarity: "dark", contrast: "normal" } },
  { state: "light-hc", value: { polarity: "light", contrast: "high" } },
  { state: "dark-hc", value: { polarity: "dark", contrast: "high" } },
];

const PREVIEW_LABEL: Readonly<Record<string, string>> = {
  light: t("appearance.preview.light"),
  dark: t("appearance.preview.dark"),
  "light-hc": t("appearance.preview.lightHc"),
  "dark-hc": t("appearance.preview.darkHc"),
};

function polarityLabel(polarity: Polarity): string {
  if (polarity === "auto") return t("appearance.polarity.auto");
  if (polarity === "dark") return t("appearance.polarity.dark");
  return t("appearance.polarity.light");
}

/**
 * The trigger's whole state in words. Auto says what it resolves to, because "Auto" on
 * its own does not tell a screen-reader operator which field they are looking at.
 */
function stateLabel(appearance: Appearance, resolved: Polarity | undefined): string {
  const polarity =
    appearance.polarity === "auto" && resolved !== undefined
      ? t("appearance.state.auto", { resolved: polarityLabel(resolved) })
      : polarityLabel(appearance.polarity);
  return appearance.contrast === "high"
    ? t("appearance.state.withContrast", { polarity })
    : polarity;
}

export function ThemeToggle({
  appearance: stored,
  secureCookies,
}: {
  /** The operator's stored choice, or `undefined` when they have not made one. */
  readonly appearance: Appearance | undefined;
  readonly secureCookies: boolean;
}) {
  const [appearance, setAppearance] = useState<Appearance>(
    stored ?? { polarity: "auto", contrast: "normal" },
  );
  const [systemPolarity, setSystemPolarity] = useState<Polarity | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const query = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const read = (): void => setSystemPolarity(query.matches ? "dark" : "light");
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);

  const apply = useCallback(
    (next: Appearance): void => {
      setAppearance(next);
      const root = document.documentElement;
      for (const candidate of APPEARANCE_CLASSES) root.classList.remove(candidate);
      for (const candidate of appearanceClasses(next)) root.classList.add(candidate);
      document.cookie = modeCookie(next, secureCookies);
    },
    [secureCookies],
  );

  /**
   * `preventScroll`, which is the whole reason this panel is not an overlay component:
   * the topbar is sticky and `html` carries its height as `scroll-padding-block-start`,
   * so a plain `focus()` here makes the browser scroll a panel that is already on screen.
   */
  useEffect(() => {
    if (!open) return;
    const selected = panelRef.current?.querySelector<HTMLElement>('input[type="radio"]:checked');
    selected?.focus({ preventScroll: true });
  }, [open]);

  // A press anywhere else dismisses it, which is what makes the panel non-modal: the page
  // behind it stays live and the first press out there is not swallowed by a scrim.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) === true) return;
      if (triggerRef.current?.contains(target) === true) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const resolved = appearance.polarity === "auto" ? systemPolarity : appearance.polarity;
  const highContrast = appearance.contrast === "high";

  const dismiss = (): void => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const focusControl = (selector: string): void => {
    panelRef.current?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  };

  const choosePolarity = (polarity: Polarity): void => {
    apply({ ...appearance, polarity });
    focusControl(`input[type="radio"][value="${polarity}"]`);
  };

  /**
   * Home and End, which the radio-group pattern requires and react-aria's arrow-key
   * handling does not cover. The selection moves with the focus, as it does on the
   * arrows, so the two keys behave like a longer press of the same key.
   */
  const onGroupKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Home" && event.key !== "End") return;
    const polarity = event.key === "Home" ? POLARITIES[0] : POLARITIES[POLARITIES.length - 1];
    if (polarity === undefined) return;
    event.preventDefault();
    choosePolarity(polarity);
  };

  /**
   * Tabbing past the last control closes the panel, which is what a non-modal dialog owes
   * a keyboard operator: focus is not contained, so without this the panel stays open
   * behind whatever they moved to.
   *
   * Read on the next tick from `activeElement` rather than from `relatedTarget`, because
   * a press inside reports focus moving to nothing on its way back to the control, and
   * closing on that shut the panel under the operator. Where focus SETTLES is the only
   * honest answer, and the body is not an answer: it means focus was dropped, not moved.
   */
  const onPanelBlur = (event: React.FocusEvent<HTMLDivElement>): void => {
    const panel = event.currentTarget;
    globalThis.setTimeout(() => {
      const active = document.activeElement;
      if (active === null || active === document.body) return;
      if (panel.contains(active)) return;
      setOpen(false);
    }, 0);
  };

  return (
    <div className="qcms-appearance" data-testid="appearance-menu">
      <button
        ref={triggerRef}
        type="button"
        className="qcms-modetrigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("appearance.trigger", { state: stateLabel(appearance, resolved) })}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) dismiss();
        }}
      >
        <AppearanceGlyph polarity={appearance.polarity} highContrast={highContrast} />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={t("appearance.title")}
          className="qcms-appearance__pop"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            dismiss();
          }}
        >
          <div className="qcms-appearance__panel" ref={panelRef} onBlur={onPanelBlur}>
            <RadioGroup
              className="qcms-appearance__group"
              aria-label={t("appearance.theme.legend")}
              value={appearance.polarity}
              onChange={(value) => {
                const polarity = POLARITIES.find((candidate) => candidate === value);
                if (polarity !== undefined) choosePolarity(polarity);
              }}
            >
              <span className="qcms-appearance__legend">{t("appearance.theme.legend")}</span>
              <div className="qcms-appearance__segments" onKeyDown={onGroupKeyDown}>
                {POLARITIES.map((polarity) => (
                  <RadioField
                    key={polarity}
                    value={polarity}
                    className="qcms-appearance__segmentfield"
                  >
                    <RadioButton className="qcms-appearance__segment">
                      {polarityLabel(polarity)}
                    </RadioButton>
                  </RadioField>
                ))}
              </div>
            </RadioGroup>
            <p className="qcms-appearance__hint">
              {appearance.polarity === "auto" && resolved !== undefined
                ? t("appearance.hint.following", { resolved: polarityLabel(resolved) })
                : t("appearance.hint.fixed")}
            </p>
            <SwitchField
              isSelected={highContrast}
              onChange={(selected) => {
                apply({ ...appearance, contrast: selected ? "high" : "normal" });
                focusControl('input[role="switch"]');
              }}
            >
              <SwitchButton className="qcms-appearance__switchbutton">
                <span className="qcms-appearance__switchlabel">
                  {t("appearance.contrast.legend")}
                </span>
                {/* The word, not the knob's position: a switch whose state is carried
                    only by where a dot sits is colour-and-shape alone (WCAG 1.4.1). */}
                <span className="qcms-appearance__switchstate">
                  {highContrast ? t("appearance.contrast.on") : t("appearance.contrast.off")}
                </span>
                <span className="qcms-appearance__track" aria-hidden="true" />
              </SwitchButton>
            </SwitchField>
            <p className="qcms-appearance__note">{t("appearance.contrast.note")}</p>
            {/* A POINTER SHORTCUT AND NOTHING ELSE, so it is hidden from assistive
                technology: every state it offers is already reachable from the two
                controls above, and announcing four more buttons that duplicate them
                would make the panel longer to hear for no new function. The tiles refuse
                focus for the same reason, which is also what keeps them out of axe's
                `aria-hidden-focus` rule. */}
            <div className="qcms-appearance__preview" aria-hidden="true">
              {PREVIEW_STATES.map(({ state, value }) => {
                const current =
                  value.polarity === resolved && value.contrast === appearance.contrast;
                return (
                  <button
                    key={state}
                    type="button"
                    tabIndex={-1}
                    data-current={current ? "true" : "false"}
                    className="qcms-appearance__tile"
                    // Focus never enters this subtree: it is `aria-hidden`, and a press
                    // that moved focus into it would also leave the panel unfocused.
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => {
                      apply(value);
                      focusControl(`input[type="radio"][value="${value.polarity}"]`);
                    }}
                  >
                    {/* The scoped carrier: `app/theme.css` gives this attribute the
                        state's real token values, and everything inside paints from
                        them. */}
                    <span className="qcms-themepreview" data-state={state}>
                      <span className="qcms-themepreview__bar" />
                      <span className="qcms-themepreview__text" />
                    </span>
                    <span className="qcms-appearance__tilecaption">
                      <span className="qcms-appearance__tilecheck">
                        {current ? SELECTED_MARK : ""}
                      </span>
                      {PREVIEW_LABEL[state]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
