"use client";

import type { Appearance } from "@roonga/qcms-core";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import { Alert } from "@/components/kit";
import {
  DEFAULT_CORNERS,
  DEFAULT_DENSITY,
  DEFAULT_PROGRESS,
  appearanceFromDerived,
  appearanceFromTheme,
  currentThemeKey,
  themeSwatch,
  type DerivedTheme,
  type ThemeOption,
} from "@/lib/forms/appearance-edit";
import { contrastFailureSentence } from "@/lib/forms/appearance-report";
import type {
  CreateThemeState,
  DeriveThemeState,
  SaveAppearanceState,
} from "@/lib/forms/builder-state";
import {
  PREVIEW_CORNERS,
  PREVIEW_DENSITIES,
  PREVIEW_PROGRESS_MODES,
} from "@/lib/forms/preview-appearance";
import {
  DEFAULT_TEXT_SIZE,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  TEXT_SIZE_PRESETS,
  TEXT_SIZE_PRODUCT_CAP,
  canStepTextSize,
  cappedAtScale,
  presetSize,
  readTextSize,
  stepTextSize,
  textSizeMark,
  type TextSizeEntry,
} from "@/lib/forms/text-size";
import { t, type MessageKey } from "@/lib/i18n/en";

import { AppearanceDerive } from "./appearance-derive";

export interface FaceChoice {
  readonly key: string;
  readonly label: string;
}

const LOCK_REASON_ID = "qcms-appearance-lock-reason";
const UNSAVED_ID = "qcms-appearance-unsaved";
const SIZE_ERROR_ID = "qcms-appearance-size-error";
const SIZE_LABEL_ID = "qcms-appearance-size-label";
const THEME_FIELD_ID = "qcms-appearance-theme";
const FACE_FIELD_ID = "qcms-appearance-face";
const TINT_FIELD_ID = "qcms-appearance-page-tint";

const DENSITY_LABELS: Readonly<Record<string, MessageKey>> = {
  compact: "appearance.density.compact",
  comfortable: "appearance.density.comfortable",
  spacious: "appearance.density.spacious",
};

const CORNER_LABELS: Readonly<Record<string, MessageKey>> = {
  sharp: "appearance.corners.sharp",
  subtle: "appearance.corners.subtle",
  rounded: "appearance.corners.rounded",
  pill: "appearance.corners.pill",
};

const PROGRESS_LABELS: Readonly<Record<string, MessageKey>> = {
  "side-rail": "appearance.progress.sideRail",
  "top-indicator": "appearance.progress.topIndicator",
  none: "appearance.progress.none",
};

const SIZE_ERRORS: Readonly<Record<Exclude<TextSizeEntry["status"], "ok">, MessageKey>> = {
  empty: "appearance.textSize.empty",
  notANumber: "appearance.textSize.notANumber",
  belowFloor: "appearance.textSize.belowFloor",
  aboveCap: "appearance.textSize.aboveCap",
};

function choiceLabel(labels: Readonly<Record<string, MessageKey>>, value: string): string {
  const key = labels[value];
  return key === undefined ? value : t(key);
}

/** Native controls, because the kit's drop `aria-describedby` and a disabled one has to say why. */
function Picker({
  id,
  label,
  value,
  options,
  isDisabled,
  describedBy,
  onPick,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly label: string; readonly value: string }[];
  readonly isDisabled: boolean;
  readonly describedBy: string | undefined;
  readonly onPick: (value: string) => void;
}) {
  return (
    <>
      <label className="qcms-adrawer__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="qcms-adrawer__select"
        value={value}
        disabled={isDisabled}
        {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
        onChange={(event) => {
          onPick(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </>
  );
}

function Segments({
  label,
  values,
  labels,
  current,
  isDisabled,
  describedBy,
  onPick,
}: {
  readonly label: string;
  readonly values: readonly string[];
  readonly labels: Readonly<Record<string, MessageKey>>;
  readonly current: string;
  readonly isDisabled: boolean;
  readonly describedBy: string | undefined;
  readonly onPick: (value: string) => void;
}) {
  return (
    <div className="qcms-adrawer__field">
      <span className="qcms-adrawer__label">{label}</span>
      <div className="qcms-segments" role="group" aria-label={label}>
        {values.map((value) => (
          <button
            key={value}
            type="button"
            className="qcms-segment"
            aria-pressed={value === current}
            disabled={isDisabled}
            {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
            onClick={() => {
              onPick(value);
            }}
          >
            {choiceLabel(labels, value)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The themes offered, with a first row naming where a form with no theme of its own gets its look. */
function themeChoices(
  themes: readonly ThemeOption[],
  themeKey: string | undefined,
  noAppearance: boolean,
  unsaved: boolean,
): readonly { readonly label: string; readonly value: string }[] {
  const label = (): string => {
    if (unsaved) return t("appearance.derive.notSaved");
    return noAppearance ? t("appearance.theme.deployment") : t("appearance.theme.ownColours");
  };
  const current = themeKey === undefined || unsaved ? [{ label: label(), value: "" }] : [];
  return [...current, ...themes.map((theme) => ({ label: theme.name, value: theme.key }))];
}

function Swatch({ palettes }: { readonly palettes: Appearance["palettes"] }) {
  const [accent, page, ink] = themeSwatch(palettes);
  return (
    <span className="qcms-adrawer__chip" aria-hidden="true">
      <span style={{ backgroundColor: accent }} />
      <span style={{ backgroundColor: page }} />
      <span style={{ backgroundColor: ink }} />
    </span>
  );
}

/**
 * A form's appearance beside the live preview: every change renders at once and is kept by Done,
 * which is the draft save. A locked workspace disables the lot, because the save would be refused.
 */
export function AppearanceDrawer({
  appearance,
  themes,
  faces,
  locked,
  handedOffAddress,
  handedOffThemeName,
  onDerive,
  onCreateTheme,
  onPreview,
  onSave,
  onClose,
}: {
  readonly appearance: Appearance | null;
  readonly themes: readonly ThemeOption[];
  readonly faces: readonly FaceChoice[];
  readonly locked: boolean;
  /** The address a confirmed `theme.derive` card collected, which only the person typed. */
  readonly handedOffAddress: { readonly url: string; readonly nonce: number } | undefined;
  /** The theme name a confirmed `theme.save` card named. */
  readonly handedOffThemeName: { readonly name: string; readonly nonce: number } | undefined;
  readonly onDerive: (url: string) => Promise<DeriveThemeState>;
  readonly onCreateTheme: (
    name: string,
    look: Appearance,
    sourceHost: string | null,
  ) => Promise<CreateThemeState>;
  readonly onPreview: (next: Appearance | null) => void;
  readonly onSave: (next: Appearance | null) => Promise<SaveAppearanceState>;
  readonly onClose: () => void;
}): ReactNode {
  const heading = useRef<HTMLHeadingElement>(null);
  const sizeField = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<SaveAppearanceState | undefined>(undefined);
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const [unsaved, setUnsaved] = useState<{ readonly host: string } | undefined>(undefined);
  const [beforeDerive, setBeforeDerive] = useState<Appearance | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const themeKey = currentThemeKey(appearance, themes);
  const size = appearance?.textSize ?? DEFAULT_TEXT_SIZE;
  const entry: TextSizeEntry =
    typed === undefined ? { status: "ok", px: size } : readTextSize(typed);
  const mark = textSizeMark(size);
  const capped = cappedAtScale(size);
  /* Every axis but the theme needs palettes to sit on, so a form on the deployment default
     offers the theme alone until one is chosen. */
  const noAppearance = appearance === null;
  const off = locked || noAppearance;
  const reason = locked ? LOCK_REASON_ID : undefined;

  const change = (next: Appearance | null): void => {
    setState(undefined);
    onPreview(next);
  };

  const edit = (patch: Partial<Appearance>): void => {
    if (appearance === null) return;
    change({ ...appearance, ...patch });
  };

  const applySize = (px: number): void => {
    setTyped(undefined);
    edit({ textSize: px });
  };

  return (
    <aside
      className="qcms-adrawer"
      aria-labelledby="qcms-appearance-drawer-heading"
      data-testid="qcms-appearance-drawer"
      data-locked={locked ? "" : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="qcms-adrawer__head">
        <h3
          id="qcms-appearance-drawer-heading"
          ref={heading}
          tabIndex={-1}
          className="qcms-adrawer__heading"
        >
          {t("appearance.drawer.heading")}
        </h3>
        <span className="qcms-adrawer__scope">{t("appearance.drawer.scope")}</span>
        <button
          type="button"
          className="qcms-adrawer__close"
          onClick={onClose}
          aria-label={t("appearance.drawer.close")}
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </div>

      <div className="qcms-adrawer__body">
        {locked && (
          <p
            id={LOCK_REASON_ID}
            className="qcms-adrawer__locked"
            data-testid="qcms-appearance-locked"
          >
            {t("appearance.locked")}
          </p>
        )}

        {state?.status === "saved" && <Alert variant="success">{t("appearance.saved")}</Alert>}
        {state?.status === "error" && (
          <div data-testid="qcms-appearance-save-error">
            <Alert variant="error">{state.message}</Alert>
            {state.failures.length > 0 && (
              <ul className="qcms-adrawer__failures">
                {state.failures.map((failure) => (
                  <li key={`${failure.palette}:${failure.foreground}:${failure.background}`}>
                    {contrastFailureSentence(failure)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="qcms-adrawer__field">
          <Picker
            id={THEME_FIELD_ID}
            label={t("appearance.theme")}
            value={unsaved === undefined ? (themeKey ?? "") : ""}
            isDisabled={locked}
            describedBy={describedBy(unsaved === undefined ? undefined : UNSAVED_ID, reason)}
            options={themeChoices(themes, themeKey, noAppearance, unsaved !== undefined)}
            onPick={(next) => {
              const theme = themes.find((candidate) => candidate.key === next);
              if (theme === undefined) return;
              setUnsaved(undefined);
              change(appearanceFromTheme(theme, appearance));
            }}
          />
          {unsaved !== undefined && (
            <p className="qcms-adrawer__hint" id={UNSAVED_ID} data-testid="qcms-appearance-unsaved">
              {t("appearance.derive.notSaved.hint")}
            </p>
          )}
          {appearance !== null && <Swatch palettes={appearance.palettes} />}
          <div className="qcms-adrawer__check">
            <input
              id={TINT_FIELD_ID}
              type="checkbox"
              checked={appearance?.pageTint === true}
              disabled={off}
              {...(reason === undefined ? {} : { "aria-describedby": reason })}
              onChange={(event) => {
                edit({ pageTint: event.target.checked });
              }}
            />
            <label htmlFor={TINT_FIELD_ID}>{t("appearance.pageTint")}</label>
          </div>
        </div>

        <div className="qcms-adrawer__field">
          <Picker
            id={FACE_FIELD_ID}
            label={t("appearance.face")}
            value={appearance?.face ?? ""}
            isDisabled={off}
            describedBy={reason}
            options={faces.map((face) => ({ label: face.label, value: face.key }))}
            onPick={(next) => {
              edit({ face: next as Appearance["face"] });
            }}
          />
          {appearance?.logo !== null && appearance !== null && (
            <p className="qcms-adrawer__hint">{t("appearance.logo.fromTheme")}</p>
          )}
        </div>

        <div className="qcms-adrawer__field">
          <span className="qcms-adrawer__label" id={SIZE_LABEL_ID}>
            {t("appearance.textSize")}
          </span>
          <div className="qcms-segments" role="group" aria-label={t("appearance.textSize.presets")}>
            {TEXT_SIZE_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className="qcms-segment"
                aria-pressed={mark === preset.key}
                disabled={off}
                {...(reason === undefined ? {} : { "aria-describedby": reason })}
                onClick={() => {
                  applySize(presetSize(preset.key));
                }}
              >
                {t(`appearance.textSize.${preset.key}` as MessageKey)}
              </button>
            ))}
            <button
              type="button"
              className="qcms-segment"
              aria-pressed={mark === "custom"}
              disabled={off}
              {...(reason === undefined ? {} : { "aria-describedby": reason })}
              onClick={() => {
                sizeField.current?.focus();
              }}
            >
              {t("appearance.textSize.custom")}
            </button>
          </div>
          <div className="qcms-adrawer__number">
            <button
              type="button"
              className="qcms-adrawer__step"
              aria-label={t("appearance.textSize.decrease")}
              disabled={off || !canStepTextSize(size, -1)}
              {...(reason === undefined ? {} : { "aria-describedby": reason })}
              onClick={() => {
                applySize(stepTextSize(size, -1));
              }}
            >
              <span aria-hidden="true">&minus;</span>
            </button>
            <input
              ref={sizeField}
              type="text"
              inputMode="numeric"
              className="qcms-adrawer__size"
              data-testid="qcms-appearance-text-size"
              aria-labelledby={SIZE_LABEL_ID}
              aria-invalid={entry.status === "ok" ? undefined : true}
              aria-describedby={describedBy(
                entry.status === "ok" ? undefined : SIZE_ERROR_ID,
                reason,
              )}
              disabled={off}
              value={typed ?? String(size)}
              onChange={(event) => {
                const raw = event.target.value;
                setTyped(raw);
                const read = readTextSize(raw);
                if (read.status === "ok") applySize(read.px);
              }}
              onBlur={() => {
                setTyped(undefined);
              }}
            />
            <span className="qcms-adrawer__unit">{t("appearance.textSize.unit")}</span>
            <button
              type="button"
              className="qcms-adrawer__step"
              aria-label={t("appearance.textSize.increase")}
              disabled={off || !canStepTextSize(size, 1)}
              {...(reason === undefined ? {} : { "aria-describedby": reason })}
              onClick={() => {
                applySize(stepTextSize(size, 1));
              }}
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>
          {entry.status === "ok" ? (
            <p className="qcms-adrawer__hint">
              {t("appearance.textSize.bounds", { min: TEXT_SIZE_MIN, max: TEXT_SIZE_MAX })}
            </p>
          ) : (
            <p id={SIZE_ERROR_ID} className="qcms-adrawer__error" role="alert">
              {t(SIZE_ERRORS[entry.status])}
            </p>
          )}
          {capped !== null && (
            <p className="qcms-adrawer__hint" data-testid="qcms-appearance-cap">
              {t("appearance.textSize.cap", { scale: capped, cap: TEXT_SIZE_PRODUCT_CAP })}
            </p>
          )}
        </div>

        <Segments
          label={t("appearance.density")}
          values={PREVIEW_DENSITIES}
          labels={DENSITY_LABELS}
          current={appearance?.density ?? DEFAULT_DENSITY}
          isDisabled={off}
          describedBy={reason}
          onPick={(value) => {
            edit({ density: value as Appearance["density"] });
          }}
        />
        <Segments
          label={t("appearance.corners")}
          values={PREVIEW_CORNERS}
          labels={CORNER_LABELS}
          current={appearance?.corners ?? DEFAULT_CORNERS}
          isDisabled={off}
          describedBy={reason}
          onPick={(value) => {
            edit({ corners: value as Appearance["corners"] });
          }}
        />
        <Segments
          label={t("appearance.progress")}
          values={PREVIEW_PROGRESS_MODES}
          labels={PROGRESS_LABELS}
          current={appearance?.progress ?? DEFAULT_PROGRESS}
          isDisabled={off}
          describedBy={reason}
          onPick={(value) => {
            edit({ progress: value as Appearance["progress"] });
          }}
        />

        <AppearanceDerive
          locked={locked}
          describedBy={reason}
          handedOff={handedOffAddress}
          handedOffName={handedOffThemeName}
          canSave={appearance !== null}
          onDerive={onDerive}
          onCreateTheme={(name) =>
            appearance === null
              ? Promise.resolve<CreateThemeState>({
                  status: "error",
                  code: "INVALID_THEME",
                  message: t("themes.error.invalid"),
                })
              : onCreateTheme(name, appearance, unsaved?.host ?? null)
          }
          onApply={(derived: DerivedTheme, host) => {
            setBeforeDerive(appearance);
            setUnsaved({ host });
            change(appearanceFromDerived(derived, appearance));
          }}
          onDiscard={() => {
            setUnsaved(undefined);
            change(beforeDerive);
          }}
          onSaved={() => {
            setUnsaved(undefined);
          }}
        />

        <div className="qcms-adrawer__field">
          <span className="qcms-adrawer__label">{t("appearance.respondent")}</span>
          <ul className="qcms-adrawer__respondent">
            <li>{t("appearance.respondent.display")}</li>
            <li>{t("appearance.respondent.contrast")}</li>
            <li>{t("appearance.respondent.textSize")}</li>
          </ul>
          <p className="qcms-adrawer__hint">{t("appearance.respondent.note")}</p>
        </div>
      </div>

      <div className="qcms-adrawer__foot">
        <button
          type="button"
          className="qcms-adrawer__reset"
          disabled={off || pending}
          {...(reason === undefined ? {} : { "aria-describedby": reason })}
          onClick={() => {
            change(null);
          }}
        >
          {t("appearance.reset")}
        </button>
        <button
          type="button"
          className="qcms-adrawer__done"
          data-testid="qcms-appearance-done"
          disabled={locked || pending || entry.status !== "ok"}
          {...(reason === undefined ? {} : { "aria-describedby": reason })}
          onClick={() => {
            startTransition(async () => {
              setState(await onSave(appearance));
            });
          }}
        >
          {pending ? t("appearance.saving") : t("appearance.done")}
        </button>
      </div>
    </aside>
  );
}

function describedBy(...ids: readonly (string | undefined)[]): string | undefined {
  const named = ids.filter((id) => id !== undefined);
  return named.length === 0 ? undefined : named.join(" ");
}
