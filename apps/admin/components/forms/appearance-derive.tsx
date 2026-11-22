"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import { Alert } from "@/components/kit";
import { themeSwatch, type DerivedTheme, type ThemeCorrection } from "@/lib/forms/appearance-edit";
import type { CreateThemeState, DeriveThemeState } from "@/lib/forms/builder-state";
import { t, tPlural, type MessageKey } from "@/lib/i18n/en";

const URL_FIELD_ID = "qcms-appearance-derive-url";
const URL_HINT_ID = "qcms-appearance-derive-hint";
const NAME_FIELD_ID = "qcms-appearance-theme-name";

const PALETTE_LABELS: Readonly<Record<string, MessageKey>> = {
  light: "appearance.palette.light",
  dark: "appearance.palette.dark",
  lightHighContrast: "appearance.palette.lightHighContrast",
  darkHighContrast: "appearance.palette.darkHighContrast",
};

/** Only an https address is offered to the route, which refuses anything else anyway. */
export function isDerivableAddress(value: string): boolean {
  const typed = value.trim();
  if (!typed.toLowerCase().startsWith("https://")) return false;
  try {
    return new URL(typed).hostname !== "";
  } catch {
    return false;
  }
}

function correctionSentence(correction: ThemeCorrection): string {
  const key = PALETTE_LABELS[correction.palette];
  return t("appearance.derive.correction", {
    from: correction.from,
    to: correction.to,
    palette: key === undefined ? correction.palette : t(key),
  });
}

function Row({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

/** The values the site gave, which is everything that is kept of it besides the logo. */
function FoundValues({ derived }: { readonly derived: DerivedTheme }): ReactNode {
  const [accent, page, ink] = themeSwatch(derived.palettes);
  return (
    <dl className="qcms-aderive__values" data-testid="qcms-appearance-derive-values">
      <Row label={t("appearance.derive.row.accent")} value={accent} />
      <Row label={t("appearance.derive.row.page")} value={page} />
      <Row label={t("appearance.derive.row.ink")} value={ink} />
      <Row label={t("appearance.derive.row.face")} value={derived.face} />
      <Row
        label={t("appearance.derive.row.tint")}
        value={t(derived.pageTint ? "appearance.derive.on" : "appearance.derive.off")}
      />
      <Row
        label={t("appearance.derive.row.logo")}
        value={t(
          derived.logoKey === null ? "appearance.derive.logo.none" : "appearance.derive.logo.found",
        )}
      />
    </dl>
  );
}

function Corrections({ derived }: { readonly derived: DerivedTheme }): ReactNode {
  if (derived.corrections.length === 0 && derived.tintDropped.length === 0) return null;
  return (
    <div className="qcms-aderive__corrections" data-testid="qcms-appearance-derive-corrections">
      {derived.corrections.length > 0 && (
        <>
          <p>
            {tPlural(
              "appearance.derive.corrections.one",
              "appearance.derive.corrections.other",
              derived.corrections.length,
            )}
          </p>
          <ul>
            {derived.corrections.map((correction) => (
              <li key={`${correction.palette}:${correction.token}:${correction.to}`}>
                {correctionSentence(correction)}
              </li>
            ))}
          </ul>
        </>
      )}
      {derived.tintDropped.length > 0 && <p>{t("appearance.derive.tintDropped")}</p>}
    </div>
  );
}

export interface AppearanceDeriveProps {
  readonly locked: boolean;
  /** The lock sentence's id, which every disabled control here points at (116's pattern). */
  readonly describedBy: string | undefined;
  /** An address the assistant's card collected and the person confirmed, derived on arrival. */
  readonly handedOff: { readonly url: string; readonly nonce: number } | undefined;
  /** A theme name a confirmed `theme.save` card collected, which opens the save with it. */
  readonly handedOffName: { readonly name: string; readonly nonce: number } | undefined;
  /** No look to keep: a form on the deployment default offers the derive alone. */
  readonly canSave: boolean;
  readonly onDerive: (url: string) => Promise<DeriveThemeState>;
  readonly onCreateTheme: (name: string) => Promise<CreateThemeState>;
  /** Applies the derived look to the drawer, live, and marks it unsaved. */
  readonly onApply: (derived: DerivedTheme, host: string) => void;
  /** Drops the derived look and restores what the drawer was showing before it. */
  readonly onDiscard: () => void;
  /** The look is a workspace theme now, so the Theme row stops saying Not saved. */
  readonly onSaved: (name: string) => void;
}

/**
 * The drawer's derive flow: an address, the look it gave, and the choice to keep that look as a
 * workspace theme. Every fetch is the API's, behind SEC-18: nothing here reaches the website.
 */
/** The look the drawer is showing, kept under a name. Also where a confirmed save card lands. */
function KeepAsTheme({
  locked,
  describedBy,
  pending,
  naming,
  name,
  saving,
  onName,
  onOpen,
  onCancel,
  onSave,
}: {
  readonly locked: boolean;
  readonly describedBy: string | undefined;
  readonly pending: boolean;
  readonly naming: boolean;
  readonly name: string;
  readonly saving: CreateThemeState | undefined;
  readonly onName: (value: string) => void;
  readonly onOpen: () => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}): ReactNode {
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (naming) field.current?.focus();
  }, [naming]);

  if (saving?.status === "created") {
    return (
      <Alert variant="success">{t("appearance.themeSave.saved", { name: saving.name })}</Alert>
    );
  }
  return (
    <div className="qcms-aderive__keep">
      {saving?.status === "error" && (
        <div data-testid="qcms-appearance-theme-save-error">
          <Alert variant="error">
            {t("appearance.themeSave.failed", { message: saving.message })}
          </Alert>
        </div>
      )}
      {naming && (
        <>
          <label className="qcms-adrawer__label" htmlFor={NAME_FIELD_ID}>
            {t("appearance.themeSave.label")}
          </label>
          <input
            ref={field}
            id={NAME_FIELD_ID}
            type="text"
            className="qcms-adrawer__name"
            data-testid="qcms-appearance-theme-name"
            disabled={locked}
            {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
            value={name}
            onChange={(event) => {
              onName(event.target.value);
            }}
          />
        </>
      )}
      <div className="qcms-aderive__actions">
        <button
          type="button"
          className="qcms-adrawer__done"
          data-testid="qcms-appearance-theme-save"
          disabled={locked || pending || (naming && name.trim() === "")}
          {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
          onClick={naming ? onSave : onOpen}
        >
          {t(saveLabel(pending, naming))}
        </button>
        {naming && (
          <button
            type="button"
            className="qcms-adrawer__reset"
            data-testid="qcms-appearance-theme-cancel"
            onClick={onCancel}
          >
            {t("appearance.themeSave.cancel")}
          </button>
        )}
      </div>
    </div>
  );
}

function saveLabel(pending: boolean, naming: boolean): MessageKey {
  if (!naming) return "appearance.themeSave";
  return pending ? "appearance.themeSave.saving" : "appearance.themeSave.save";
}

/**
 * The drawer's derive flow: an address, the look it gave, and the choice to keep that look as a
 * workspace theme. Every fetch is the API's, behind SEC-18: nothing here reaches the website.
 */
export function AppearanceDerive(props: AppearanceDeriveProps): ReactNode {
  const { locked, describedBy, handedOff, handedOffName, onDerive, onApply } = props;
  const [typed, setTyped] = useState("");
  const [state, setState] = useState<DeriveThemeState | undefined>(undefined);
  const [saving, setSaving] = useState<CreateThemeState | undefined>(undefined);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  // Each hand-off is taken once, by nonce, however often its props arrive again.
  const taken = useRef<{ derive?: number; save?: number }>({});

  const derive = useCallback(
    (url: string): void => {
      setSaving(undefined);
      setNaming(false);
      startTransition(async () => {
        const next = await onDerive(url);
        setState(next);
        if (next.status === "derived") onApply(next.derived, next.host);
      });
    },
    [onApply, onDerive],
  );

  useEffect(() => {
    if (handedOff === undefined || locked || taken.current.derive === handedOff.nonce) return;
    taken.current.derive = handedOff.nonce;
    setTyped(handedOff.url);
    if (isDerivableAddress(handedOff.url)) derive(handedOff.url);
  }, [derive, handedOff, locked]);

  useEffect(() => {
    if (handedOffName === undefined || locked || taken.current.save === handedOffName.nonce) return;
    taken.current.save = handedOffName.nonce;
    setSaving(undefined);
    setName(handedOffName.name);
    setNaming(true);
  }, [handedOffName, locked]);

  const derived = state?.status === "derived" ? state.derived : undefined;
  const ready = isDerivableAddress(typed);

  return (
    <div className="qcms-adrawer__field qcms-aderive" data-testid="qcms-appearance-derive">
      <hr className="qcms-adrawer__rule" />
      <span className="qcms-adrawer__label">{t("appearance.derive.heading")}</span>
      <label className="qcms-adrawer__label" htmlFor={URL_FIELD_ID}>
        {t("appearance.derive.label")}
      </label>
      <input
        id={URL_FIELD_ID}
        type="url"
        inputMode="url"
        className="qcms-adrawer__url"
        data-testid="qcms-appearance-derive-url"
        placeholder={t("appearance.derive.placeholder")}
        aria-describedby={[URL_HINT_ID, describedBy].filter((id) => id !== undefined).join(" ")}
        disabled={locked}
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
      />
      <p className="qcms-adrawer__hint" id={URL_HINT_ID}>
        {t("appearance.derive.hint")}
      </p>
      <button
        type="button"
        className="qcms-adrawer__derive"
        data-testid="qcms-appearance-derive-get"
        disabled={locked || pending || !ready}
        {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
        onClick={() => {
          derive(typed.trim());
        }}
      >
        {t(pending ? "appearance.derive.working" : "appearance.derive.get")}
      </button>

      {state?.status === "error" && (
        <div data-testid="qcms-appearance-derive-error">
          <Alert variant="error">{t("appearance.derive.failed", { message: state.message })}</Alert>
        </div>
      )}

      {derived !== undefined && (
        <div className="qcms-aderive__result">
          <span className="qcms-adrawer__label">{t("appearance.derive.found")}</span>
          <FoundValues derived={derived} />
          <p className="qcms-adrawer__hint">{t("appearance.derive.stored")}</p>
          <Corrections derived={derived} />
          <div className="qcms-aderive__actions">
            <button
              type="button"
              className="qcms-adrawer__reset"
              data-testid="qcms-appearance-derive-adjust"
              onClick={() => {
                setState(undefined);
              }}
            >
              {t("appearance.derive.adjust")}
            </button>
            <button
              type="button"
              className="qcms-adrawer__reset"
              data-testid="qcms-appearance-derive-cancel"
              onClick={() => {
                setState(undefined);
                setNaming(false);
                setName("");
                props.onDiscard();
              }}
            >
              {t("appearance.derive.cancel")}
            </button>
          </div>
        </div>
      )}

      {props.canSave && (
        <KeepAsTheme
          locked={locked}
          describedBy={describedBy}
          pending={pending}
          naming={naming}
          name={name}
          saving={saving}
          onName={setName}
          onOpen={() => {
            setNaming(true);
          }}
          onCancel={() => {
            setNaming(false);
          }}
          onSave={() => {
            startTransition(async () => {
              const next = await props.onCreateTheme(name.trim());
              setSaving(next);
              if (next.status === "created") props.onSaved(next.name);
            });
          }}
        />
      )}
    </div>
  );
}
