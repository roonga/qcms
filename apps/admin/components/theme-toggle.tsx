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

/*
 * The panel is this app's own absolutely positioned box rather than react-aria's
 * `Popover`, which closes on any scroll reaching the trigger - including the zero-delta
 * one the browser fires when a focused panel clears the sticky topbar's scroll padding.
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

  // `preventScroll`: `html` carries the sticky topbar's height as
  // `scroll-padding-block-start`, so a plain `focus()` scrolls a panel already on screen.
  useEffect(() => {
    if (!open) return;
    const selected = panelRef.current?.querySelector<HTMLElement>('input[type="radio"]:checked');
    selected?.focus({ preventScroll: true });
  }, [open]);

  // Non-modal: there is no scrim, so the first press outside reaches the page it lands on.
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
   * Focus is not contained, so tabbing past the last control has to close the panel.
   * Measured on the next tick from `activeElement`, because a press inside reports focus
   * passing through nothing, and the body means focus was dropped rather than moved out.
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
                {/* A state carried only by where a dot sits is shape alone (WCAG 1.4.1). */}
                <span className="qcms-appearance__switchstate">
                  {highContrast ? t("appearance.contrast.on") : t("appearance.contrast.off")}
                </span>
                <span className="qcms-appearance__track" aria-hidden="true" />
              </SwitchButton>
            </SwitchField>
            <p className="qcms-appearance__note">{t("appearance.contrast.note")}</p>
            {/* Hidden from assistive technology because it duplicates the two controls
                above; the tiles refuse focus, which is what keeps `aria-hidden` valid. */}
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
                    // A press must not take focus into an `aria-hidden` subtree.
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => {
                      apply(value);
                      focusControl(`input[type="radio"][value="${value.polarity}"]`);
                    }}
                  >
                    {/* The scoped carrier: `app/theme.css` gives this attribute the
                        state's real token values. */}
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
