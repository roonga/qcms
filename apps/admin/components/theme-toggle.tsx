"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppearanceGlyph } from "@/components/appearance-glyph";
import {
  AriaButton,
  AriaDialog,
  AriaPopover,
  DialogTrigger,
  RadioButton,
  RadioField,
  RadioGroup,
  SwitchButton,
  SwitchField,
} from "@/components/kit";
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
 * "Light / Dark / High contrast" presents two different questions as one list, and a
 * dark field at high contrast has no row at all. Polarity and contrast are independent
 * on the platform too (`prefers-color-scheme` and `prefers-contrast` are separate media
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
  const groupRef = useRef<HTMLDivElement>(null);

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

  const resolved = appearance.polarity === "auto" ? systemPolarity : appearance.polarity;
  const highContrast = appearance.contrast === "high";

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
    apply({ ...appearance, polarity });
    const inputs = groupRef.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    const target = event.key === "Home" ? inputs?.item(0) : inputs?.item((inputs.length ?? 1) - 1);
    target?.focus();
  };

  /**
   * Tabbing past the last control closes the popover, which is what a non-modal dialog
   * owes a keyboard operator: focus is not contained, so without this the popover stays
   * open behind whatever they moved to.
   *
   * A null `relatedTarget` is NOT that case and must not close anything: react-aria's
   * labels take a press without moving focus, so every pointer press inside the panel
   * reports focus going nowhere. Closing on it shut the panel under the operator.
   */
  const onDialogBlur = (event: React.FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget;
    if (next === null || event.currentTarget.contains(next)) return;
    setOpen(false);
  };

  return (
    <div className="qcms-appearance" data-testid="appearance-menu">
      <DialogTrigger isOpen={open} onOpenChange={setOpen}>
        <AriaButton
          className="qcms-modetrigger"
          aria-label={t("appearance.trigger", { state: stateLabel(appearance, resolved) })}
        >
          <AppearanceGlyph polarity={appearance.polarity} highContrast={highContrast} />
        </AriaButton>
        {/* Non-modal: this is a preference, not a decision the operator has to finish.
            The page behind it stays live, which also means the four preview tiles are
            not the only way to see a state applied. */}
        <AriaPopover isNonModal placement="bottom end" className="qcms-appearance__pop">
          <AriaDialog aria-label={t("appearance.title")} className="qcms-appearance__dialog">
            {/* The handlers ride a wrapper rather than the primitives: neither RAC's
                `Dialog` nor its `RadioGroup` forwards arbitrary DOM props, and focus and
                key events both bubble, so one element below each is enough. */}
            <div className="qcms-appearance__panel" onBlur={onDialogBlur}>
              <RadioGroup
                className="qcms-appearance__group"
                aria-label={t("appearance.theme.legend")}
                value={appearance.polarity}
                onChange={(value) => {
                  const polarity = POLARITIES.find((candidate) => candidate === value);
                  if (polarity !== undefined) apply({ ...appearance, polarity });
                }}
              >
                <span className="qcms-appearance__legend">{t("appearance.theme.legend")}</span>
                <div
                  className="qcms-appearance__segments"
                  ref={groupRef}
                  onKeyDown={onGroupKeyDown}
                >
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
                onChange={(selected) =>
                  apply({ ...appearance, contrast: selected ? "high" : "normal" })
                }
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
                      // A press that moved focus into a hidden subtree would also fire the
                      // blur handler above and close the panel under the pointer.
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => apply(value)}
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
          </AriaDialog>
        </AriaPopover>
      </DialogTrigger>
    </div>
  );
}
