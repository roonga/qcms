"use client";

/**
 * The respondent's appearance controls: colour mode, font and density (task 053,
 * ADR-30 exit criteria 3 and 5).
 *
 * WHAT EACH CONTROL DOES
 * Each writes a long-lived cookie and swaps one root class, in that order but with
 * no round trip: the class swap is what the respondent sees immediately, and the
 * cookie is what makes the NEXT server render already correct, so a reload, a step
 * navigation or a resumed session never flashes back to the deployment default.
 * The token contract does the rest - mode selects a palette, the font class
 * repoints `--font-portal`, and density swaps the five `--space-*` values - so
 * nothing here knows a single colour, family or pixel.
 *
 * SELECTED STATE IS NEVER COLOUR-ONLY (an exit criterion, not a nicety)
 * A chip that only changed colour would be unreadable in High-contrast, where the
 * palette collapses to black on white, and ambiguous for a colour-blind
 * respondent - and this control is precisely the one such a respondent has to
 * operate to fix their own experience. So the selected chip carries FOUR
 * differences: a check glyph that is absent otherwise, a heavier border, a bolder
 * label, and (only then) a filled background. Three of the four survive a palette
 * with two colours in it. The glyph slot is always rendered, so selecting a chip
 * moves no text.
 *
 * KEYBOARD BEHAVIOUR IS THE PLATFORM'S
 * Mode and density are native radio groups in a `fieldset`/`legend`, drawn as
 * chips through a visually-hidden input. That is deliberate rather than a
 * `role="radiogroup"` of buttons: it gets roving tab order, arrow-key traversal,
 * the group name announced with each option, and the "N of 3" position count from
 * the browser, none of which then has to be reimplemented or tested for. Font is a
 * native `<select>` with `<optgroup>`, which is also how the registry's groups
 * reach a screen reader for free.
 *
 * WITHOUT JAVASCRIPT the whole control is hidden (the `<noscript>` rule in
 * `app/layout.tsx`), because a radio a respondent can move but that changes
 * nothing is worse than no control. The deployment's configured default still
 * applies, and it is a server render, so a no-JS respondent sees a correct page -
 * just not a switchable one. See docs/theming.md.
 */

import { fontClass } from "@qcms/ui/fonts";
import { useEffect, useState, type ReactNode } from "react";

import { useAppearance, type FontChoice } from "@/components/appearance-context";
import {
  APPEARANCE_MODES,
  DENSITY_CLASSES,
  DENSITY_LEVELS,
  DENSITY_COOKIE,
  FONT_COOKIE,
  MODE_COOKIE,
  appearanceCookie,
  densityClass,
  type AppearanceMode,
  type Density,
} from "@/lib/appearance";
import { t } from "@/lib/i18n/en";

/** The check glyph on the selected chip. U+2713, never an em dash or a control char. */
const SELECTED_MARK = "✓";

/**
 * Three horizontal rules whose gaps widen with the level: the density "icon" of
 * ADR-30's icon toggle. Purely decorative, so `aria-hidden` - the visible text
 * label beside it is what names the option, and an icon-only toggle would put the
 * whole meaning of this control behind a glyph a respondent has to guess.
 */
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

/** The icon gap per level, tightest to loosest. */
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
 * One radio group drawn as a row of chips. `name` groups the inputs for the
 * browser's arrow-key traversal; `data-selected` is the styling and testing hook,
 * set from React state rather than read back from `:checked` so the server-rendered
 * markup already carries it.
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
              {/* Always rendered so the glyph appearing shifts no text. The radio's
                  own checked state is what conveys selection to a screen reader, so
                  the mark is decorative there and announced text is not duplicated. */}
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

/** The offered fonts as `<optgroup>`s, keeping the registry's own group order. */
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
  const [mode, setMode] = useState<AppearanceMode>(state?.mode ?? "light");
  const [font, setFont] = useState<string>(state?.font ?? "");
  const [density, setDensity] = useState<Density>(state?.density ?? "comfortable");

  // The root class is the truth about the mode; the server's stamp is only its best
  // guess at render time. The pre-paint script can land on something else from a
  // `?mode=` parameter or from `prefers-color-scheme` / `prefers-contrast`, all of
  // which are inputs that did not exist when the HTML was generated - so without
  // this the chips could claim Light while the respondent is looking at Dark.
  //
  // Read UNCONDITIONALLY rather than only in the cases known to diverge. Enumerating
  // those cases means keeping two precedence chains in agreement (this one and the
  // script's), and the read costs one `classList` lookup; when they agree, the
  // `setState` is a no-op. It runs after hydration, so it corrects the CONTROL only:
  // the page itself was painted correctly by the script, before anything was drawn.
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

  return (
    <details className="qcms-appearance" data-testid="appearance">
      <summary className="qcms-appearance__summary">
        {/* The conventional contrast glyph: a circle with one half filled. It says
            "how this looks" far more directly than a gear, and it is decorative
            either way - the visible label is what names the control. */}
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
      <div className="qcms-appearance__panel">
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
      </div>
    </details>
  );
}
