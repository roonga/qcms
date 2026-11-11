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

/* Use a custom panel: react-aria Popover closes on the trigger's zero-delta focus scroll, producing a
   flicker on open. */

function polarityLabel(polarity: Polarity): string {
  if (polarity === "auto") return t("appearance.polarity.auto");
  if (polarity === "dark") return t("appearance.polarity.dark");
  return t("appearance.polarity.light");
}

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

  // Prevent scroll when focusing: the sticky topbar's scroll padding would otherwise scroll an
  // already-visible panel.
  useEffect(() => {
    if (!open) return;
    const selected = panelRef.current?.querySelector<HTMLElement>('input[type="radio"]:checked');
    selected?.focus({ preventScroll: true });
  }, [open]);

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

  /* Add Home and End because react-aria's arrow handling does not implement them for this radio-group
     pattern. */
  const onGroupKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Home" && event.key !== "End") return;
    const polarity = event.key === "Home" ? POLARITIES[0] : POLARITIES[POLARITIES.length - 1];
    if (polarity === undefined) return;
    event.preventDefault();
    choosePolarity(polarity);
  };

  /* Check blur next tick: an internal press can temporarily report no focus. Ignore detached panels so stale
     blur cannot close a reopen. */
  const onPanelBlur = (event: React.FocusEvent<HTMLDivElement>): void => {
    const panel = event.currentTarget;
    globalThis.setTimeout(() => {
      if (!panel.isConnected) return;
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
        className="qcms-iconbutton"
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
                <span className="qcms-appearance__switchstate">
                  {highContrast ? t("appearance.contrast.on") : t("appearance.contrast.off")}
                </span>
                <span className="qcms-appearance__track" aria-hidden="true" />
              </SwitchButton>
            </SwitchField>
          </div>
        </div>
      ) : null}
    </div>
  );
}
