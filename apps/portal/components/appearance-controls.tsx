"use client";

import { fontClass } from "@roonga/qcms-ui/fonts";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type KeyboardEvent } from "react";

import { useAppearance, type FontChoice } from "@/components/appearance-context";
import {
  APPEARANCE_MODES,
  APPEARANCE_ROUTE,
  BASELINE_PREFIX,
  FONT_COOKIE,
  MODE_COOKIE,
  RETURN_FIELD,
  TEXT_SCALE_CLASSES,
  TEXT_SCALES,
  TEXT_SIZE_COOKIE,
  appearanceCookie,
  textScaleClass,
  type AppearanceMode,
  type TextScale,
} from "@/lib/appearance";
import { t } from "@/lib/i18n/en";

const SELECTED_MARK = "✓";

interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

/**
 * `data-selected` is set from React state rather than read back from `:checked`, so the
 * server-rendered markup already carries it.
 */
function Segmented<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
}: {
  readonly name: string;
  readonly legend: string;
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (next: T) => void;
}) {
  return (
    <fieldset className="qcms-seg" data-testid={`appearance-${name}`}>
      <legend className="qcms-seg__legend">{legend}</legend>
      <div className="qcms-seg__row">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className="qcms-seg__chip"
              data-selected={selected ? "true" : "false"}
              data-value={option.value}
            >
              <input
                className="qcms-seg__input"
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
              />
              {/* Always rendered so the glyph appearing shifts no text, and decorative
                  because the radio's own checked state conveys selection. */}
              <span className="qcms-seg__mark" aria-hidden="true">
                {selected ? SELECTED_MARK : ""}
              </span>
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// Keeps the registry's own group order.
function fontGroups(fonts: readonly FontChoice[]): readonly [string, readonly FontChoice[]][] {
  const groups: [string, FontChoice[]][] = [];
  for (const font of fonts) {
    const existing = groups.find(([name]) => name === font.group);
    if (existing) existing[1].push(font);
    else groups.push([font.group, [font]]);
  }
  return groups;
}

export function AppearanceControls() {
  const state = useAppearance();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const basePath = state?.basePath ?? "";
  const prefixed =
    basePath === "" || pathname === basePath || pathname.startsWith(`${basePath}/`)
      ? pathname
      : `${basePath}${pathname}`;
  const returnTo = search === "" ? prefixed : `${prefixed}?${search}`;
  const [mode, setMode] = useState<AppearanceMode>(state?.mode ?? "light");
  const [font, setFont] = useState<string>(state?.font ?? "");
  const [textScale, setTextScale] = useState<TextScale>(state?.textScale ?? "100");

  useEffect(() => {
    const live = APPEARANCE_MODES.find((candidate) =>
      document.documentElement.classList.contains(candidate),
    );
    if (live !== undefined) setMode(live);
  }, []);

  if (state === null) return null;
  const secure = state.secureCookies;

  const swapRootClass = (remove: readonly string[], add: string): void => {
    const root = document.documentElement;
    for (const className of remove) root.classList.remove(className);
    if (add !== "") root.classList.add(add);
  };

  const chooseMode = (next: AppearanceMode): void => {
    setMode(next);
    swapRootClass(APPEARANCE_MODES, next);
    document.cookie = appearanceCookie(MODE_COOKIE, next, secure);
  };

  const chooseFont = (next: string): void => {
    setFont(next);
    swapRootClass(
      state.fonts.map((entry) => fontClass(entry.key)),
      fontClass(next),
    );
    document.cookie = appearanceCookie(FONT_COOKIE, next, secure);
  };

  const chooseTextScale = (next: TextScale): void => {
    setTextScale(next);
    swapRootClass(TEXT_SCALE_CLASSES, textScaleClass(next));
    document.cookie = appearanceCookie(TEXT_SIZE_COOKIE, next, secure);
  };

  const closeOnEscape = (event: KeyboardEvent<HTMLDetailsElement>): void => {
    if (event.key !== "Escape" || !event.currentTarget.open) return;
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary")?.focus();
  };

  // Hydrated, the form never submits: the click handlers have already applied the choice,
  // so a navigation would only cost a reload. With no JavaScript there is no handler and
  // the browser posts natively.
  const keepOnPage = (event: { preventDefault: () => void }): void => {
    event.preventDefault();
  };

  return (
    <details className="qcms-appearance" data-testid="appearance" onKeyDown={closeOnEscape}>
      <summary className="qcms-appearance__summary">
        {/* Decorative: the visible label names the control. */}
        <svg
          aria-hidden="true"
          className="qcms-seg__icon"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none" />
        </svg>
        {t("appearance.title")}
      </summary>
      <form
        className="qcms-appearance__panel"
        method="post"
        action={APPEARANCE_ROUTE}
        onSubmit={keepOnPage}
      >
        <input type="hidden" name={RETURN_FIELD} value={returnTo} />
        {/* The rendered values, so the no-JS route saves only the axes the respondent changed. */}
        <input type="hidden" name={`${BASELINE_PREFIX}mode`} value={state.mode} />
        <input type="hidden" name={`${BASELINE_PREFIX}font`} value={state.font} />
        <input type="hidden" name={`${BASELINE_PREFIX}textSize`} value={state.textScale} />
        <Segmented
          name="mode"
          legend={t("appearance.mode.legend")}
          value={mode}
          onChange={chooseMode}
          options={APPEARANCE_MODES.map((value) => ({
            value,
            label: t(`appearance.mode.${value}`),
          }))}
        />

        <div className="qcms-appearance__field">
          <label className="qcms-seg__legend" htmlFor="qcms-font-select">
            {t("appearance.font.legend")}
          </label>
          <select
            id="qcms-font-select"
            className="qcms-appearance__select"
            data-testid="appearance-font"
            // The field name the no-JS POST serializes under; it matches the schema in
            // `lib/server/appearance-form.ts`.
            name="font"
            value={font}
            onChange={(event) => chooseFont(event.target.value)}
          >
            {fontGroups(state.fonts).map(([group, entries]) => (
              <optgroup key={group} label={group}>
                {entries.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <Segmented
          name="textSize"
          legend={t("appearance.textSize.legend")}
          value={textScale}
          onChange={chooseTextScale}
          options={TEXT_SCALES.map((value) => ({
            value,
            label: t(`appearance.textSize.${value}`),
          }))}
        />

        <p className="qcms-appearance__note">{t("appearance.note")}</p>

        {/* Revealed only by the `<noscript>` rule in `app/layout.tsx`. Hidden by
            default rather than rendered conditionally, so the served HTML is the same
            document either way and a scripted respondent meets no shift. */}
        <button type="submit" className="qcms-appearance__apply">
          {t("appearance.apply")}
        </button>
      </form>
    </details>
  );
}
