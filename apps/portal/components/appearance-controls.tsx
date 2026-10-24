"use client";

/**
 * The respondent's appearance controls (ADR-30). See docs/theming.md.
 *
 * Each control swaps a root class and writes a long-lived cookie: the class swap is what
 * the respondent sees immediately, and the cookie makes the next server render already
 * correct, so a reload never flashes back to the deployment default.
 *
 * The selected chip is never colour-only, because this is precisely the control a
 * respondent with a palette of two colours has to operate to fix their own experience.
 *
 * Mode and density are native radio groups drawn as chips, rather than a
 * `role="radiogroup"` of buttons, so roving tab order, arrow-key traversal and the
 * position count come from the browser.
 *
 * Without JavaScript the same markup posts natively to `app/appearance/route.ts`. The
 * seam is one element wide, the Apply button, which is always in the markup and always
 * hidden by CSS, so scripting on costs no second render and no layout shift. Hydrated,
 * {@link AppearanceControls} calls `preventDefault` on the form, which is needed for
 * implicit submission from the `<select>`.
 */

import { fontClass } from "@roonga/qcms-ui/fonts";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { useAppearance, type FontChoice } from "@/components/appearance-context";
import {
  APPEARANCE_MODES,
  APPEARANCE_ROUTE,
  DENSITY_CLASSES,
  DENSITY_LEVELS,
  DENSITY_COOKIE,
  FONT_COOKIE,
  MODE_COOKIE,
  RETURN_FIELD,
  appearanceCookie,
  densityClass,
  type AppearanceMode,
  type Density,
} from "@/lib/appearance";
import { t } from "@/lib/i18n/en";

const SELECTED_MARK = "✓";

// Decorative: the visible text label names the option, because an icon-only toggle
// would put the whole meaning of this control behind a glyph.
function DensityIcon({ gap }: { readonly gap: number }) {
  const middle = 8;
  return (
    <svg
      aria-hidden="true"
      className="qcms-seg__icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      {[middle - gap, middle, middle + gap].map((y) => (
        <line key={y} x1="2.5" y1={y} x2="13.5" y2={y} />
      ))}
    </svg>
  );
}

const DENSITY_ICON_GAP: Readonly<Record<Density, number>> = {
  compact: 3,
  comfortable: 4.5,
  spacious: 6,
};

interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: ReactNode;
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
              {option.icon}
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
  // The page to come back to after the no-JS POST, path and query. Both hooks render on
  // the server too, so the hidden field is correct in the served HTML, which is the only
  // render a no-JS respondent gets. The query has to ride along, because screens such as
  // `/link-error?kind=expired` select their whole copy from it;
  // `lib/server/appearance-form.ts` validates the whole reference before it can become a
  // `Location`.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  // `proxy.ts` strips the environment prefix, so `usePathname()` is the rewritten path on
  // the server and the browser's own prefixed path after hydration. Prepending the prefix
  // only when it is absent makes both renders produce the same string, and keeps the
  // no-JS return address inside the respondent's own environment (Q21).
  const basePath = state?.basePath ?? "";
  const prefixed =
    basePath === "" || pathname === basePath || pathname.startsWith(`${basePath}/`)
      ? pathname
      : `${basePath}${pathname}`;
  const returnTo = search === "" ? prefixed : `${prefixed}?${search}`;
  const [mode, setMode] = useState<AppearanceMode>(state?.mode ?? "light");
  const [font, setFont] = useState<string>(state?.font ?? "");
  const [density, setDensity] = useState<Density>(state?.density ?? "comfortable");

  // The root class is the truth about the mode; the server's stamp is only its guess at
  // render time, because the pre-paint script reads inputs that did not exist then. Read
  // unconditionally rather than only in the cases known to diverge, which would mean
  // keeping two precedence chains in agreement. It corrects the control only: the page
  // itself was painted correctly by the script.
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

  const chooseDensity = (next: Density): void => {
    setDensity(next);
    swapRootClass(DENSITY_CLASSES, densityClass(next));
    document.cookie = appearanceCookie(DENSITY_COOKIE, next, secure);
  };

  // Hydrated, the form never submits: the click handlers have already applied the choice,
  // so a navigation would only cost a reload. With no JavaScript there is no handler and
  // the browser posts natively.
  const keepOnPage = (event: { preventDefault: () => void }): void => {
    event.preventDefault();
  };

  return (
    <details className="qcms-appearance" data-testid="appearance">
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
          name="density"
          legend={t("appearance.density.legend")}
          value={density}
          onChange={chooseDensity}
          options={DENSITY_LEVELS.map((value) => ({
            value,
            label: t(`appearance.density.${value}`),
            icon: <DensityIcon gap={DENSITY_ICON_GAP[value]} />,
          }))}
        />

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
