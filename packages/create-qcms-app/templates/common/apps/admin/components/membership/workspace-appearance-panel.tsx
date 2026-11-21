"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";

import { Alert, SwitchButton, SwitchField, TextField } from "@/components/kit";
import { themeSwatch, type ThemePalettes } from "@/lib/forms/appearance-edit";
import { t } from "@/lib/i18n/en";
import type { MembershipActionState } from "@/lib/membership/types";

/** One theme as the Settings list shows it; the palettes are here only for the swatch. */
export interface WorkspaceThemeRow {
  readonly themeId: string;
  readonly name: string;
  readonly palettes: ThemePalettes;
  readonly logoKey: string | null;
  readonly sourceHost: string | null;
}

const LOCK_REASON_ID = "qcms-appearance-lock-needs";
const THEME_REASON_ID = "qcms-themes-needs";

function Swatch({ palettes }: { readonly palettes: ThemePalettes }) {
  const [accent, page, ink] = themeSwatch(palettes);
  return (
    <span className="qcms-adrawer__chip" aria-hidden="true">
      <span style={{ backgroundColor: accent }} />
      <span style={{ backgroundColor: page }} />
      <span style={{ backgroundColor: ink }} />
    </span>
  );
}

async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function ThemeRow({
  theme,
  canEdit,
  pending,
  onRename,
  onRemove,
  onLogo,
}: {
  readonly theme: WorkspaceThemeRow;
  readonly canEdit: boolean;
  readonly pending: boolean;
  readonly onRename: (themeId: string, name: string) => void;
  readonly onRemove: (themeId: string) => void;
  readonly onLogo: (themeId: string, file: File) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(theme.name);
  const [confirming, setConfirming] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const reason = canEdit ? {} : { "aria-describedby": THEME_REASON_ID };

  function body(): ReactNode {
    if (renaming) {
      return (
        <div className="qcms-themes__rename">
          <TextField label={t("themes.rename.label")} value={name} onChange={setName} />
          <button
            type="button"
            className="qcms-themes__action"
            disabled={pending || name.trim() === ""}
            onClick={() => {
              setRenaming(false);
              onRename(theme.themeId, name.trim());
            }}
          >
            {t("themes.rename.save")}
          </button>
          <button
            type="button"
            className="qcms-themes__action"
            disabled={pending}
            onClick={() => {
              setName(theme.name);
              setRenaming(false);
            }}
          >
            {t("themes.rename.cancel")}
          </button>
        </div>
      );
    }
    if (confirming) {
      return (
        <div className="qcms-themes__confirm" data-testid="qcms-theme-delete-confirm">
          <p className="text-sm">{t("themes.delete.confirm", { name: theme.name })}</p>
          <button
            type="button"
            className="qcms-themes__action qcms-themes__action--danger"
            disabled={pending}
            onClick={() => {
              setConfirming(false);
              onRemove(theme.themeId);
            }}
          >
            {t("themes.delete.yes")}
          </button>
          <button
            type="button"
            className="qcms-themes__action"
            disabled={pending}
            onClick={() => {
              setConfirming(false);
            }}
          >
            {t("themes.delete.no")}
          </button>
        </div>
      );
    }
    return (
      <div className="qcms-themes__actions">
        <button
          type="button"
          className="qcms-themes__action"
          disabled={!canEdit || pending}
          {...reason}
          onClick={() => {
            setName(theme.name);
            setRenaming(true);
          }}
        >
          {t("themes.rename")}
        </button>
        <button
          type="button"
          className="qcms-themes__action"
          disabled={!canEdit || pending}
          {...reason}
          onClick={() => {
            logoInput.current?.click();
          }}
        >
          {t("themes.logo.change")}
        </button>
        <button
          type="button"
          className="qcms-themes__action qcms-themes__action--danger"
          disabled={!canEdit || pending}
          {...reason}
          onClick={() => {
            setConfirming(true);
          }}
        >
          {t("themes.delete")}
        </button>
        {/* Raster only: an SVG can carry script, so the API sniffs the bytes and refuses one. */}
        <input
          ref={logoInput}
          type="file"
          className="sr-only"
          accept="image/png,image/jpeg,image/webp"
          aria-label={t("themes.logo.input", { name: theme.name })}
          data-testid="qcms-theme-logo-input"
          disabled={!canEdit || pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file !== undefined) onLogo(theme.themeId, file);
          }}
        />
      </div>
    );
  }

  return (
    <li className="qcms-themes__row" data-testid="qcms-theme-row" data-theme-id={theme.themeId}>
      <div className="qcms-themes__identity">
        <Swatch palettes={theme.palettes} />
        <span className="font-medium">{theme.name}</span>
        {theme.sourceHost !== null && (
          <span className="text-xs text-(--color-text-muted)">
            {t("themes.source", { host: theme.sourceHost })}
          </span>
        )}
        <span className="text-xs text-(--color-text-muted)">
          {theme.logoKey === null ? t("themes.logo.none") : t("themes.logo.set")}
        </span>
      </div>
      {body()}
    </li>
  );
}

/**
 * The workspace's themes and the appearance lock. Themes are an Edit forms act and the lock is
 * an administrator's, so each half states which role it needs rather than hiding the control.
 */
export function WorkspaceAppearancePanel({
  workspaceId,
  themes,
  locked,
  canEditForms,
  canSetLock,
  rename,
  remove,
  uploadLogo,
  setLock,
}: {
  readonly workspaceId: string;
  /** Undefined when the themes read was refused, which says nothing about what exists. */
  readonly themes: readonly WorkspaceThemeRow[] | undefined;
  /** Undefined when the settings read was refused, so the switch claims no state. */
  readonly locked: boolean | undefined;
  readonly canEditForms: boolean;
  readonly canSetLock: boolean;
  readonly rename: (
    workspaceId: string,
    themeId: string,
    name: string,
  ) => Promise<MembershipActionState>;
  readonly remove: (workspaceId: string, themeId: string) => Promise<MembershipActionState>;
  readonly uploadLogo: (
    workspaceId: string,
    themeId: string,
    bytesBase64: string,
  ) => Promise<MembershipActionState>;
  readonly setLock: (workspaceId: string, locked: boolean) => Promise<MembershipActionState>;
}) {
  const [state, setState] = useState<MembershipActionState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const on = locked === true;

  const run = (act: () => Promise<MembershipActionState>): void => {
    startTransition(async () => {
      setState(await act());
    });
  };

  function list(): ReactNode {
    if (themes === undefined) {
      return <p className="text-sm text-(--color-text-muted)">{t("themes.unavailable")}</p>;
    }
    if (themes.length === 0) {
      return <p className="text-sm text-(--color-text-muted)">{t("themes.empty")}</p>;
    }
    return (
      <ul className="qcms-themes" data-testid="qcms-themes">
        {themes.map((theme) => (
          <ThemeRow
            key={theme.themeId}
            theme={theme}
            canEdit={canEditForms}
            pending={pending}
            onRename={(themeId, name) => {
              run(() => rename(workspaceId, themeId, name));
            }}
            onRemove={(themeId) => {
              run(() => remove(workspaceId, themeId));
            }}
            onLogo={(themeId, file) => {
              run(async () => uploadLogo(workspaceId, themeId, await base64Of(file)));
            }}
          />
        ))}
      </ul>
    );
  }

  return (
    <section
      aria-labelledby="qcms-workspace-appearance-heading"
      className="flex min-w-0 flex-col gap-3"
      data-testid="qcms-workspace-appearance"
    >
      <h2
        id="qcms-workspace-appearance-heading"
        className="text-lg font-semibold text-(--color-text)"
      >
        {t("themes.heading")}
      </h2>

      {state.status === "error" && <Alert variant="error">{state.message}</Alert>}
      {state.status === "done" && <Alert variant="success">{state.message}</Alert>}

      <div className="flex min-w-0 flex-col gap-1">
        <SwitchField
          isSelected={on}
          isDisabled={!canSetLock || pending || locked === undefined}
          {...(canSetLock ? {} : { "aria-describedby": LOCK_REASON_ID })}
          onChange={(selected) => {
            run(() => setLock(workspaceId, selected));
          }}
        >
          <SwitchButton className="qcms-appearance__switchbutton">
            <span className="qcms-appearance__switchlabel">{t("themes.lock")}</span>
            <span className="qcms-appearance__switchstate">
              {on ? t("themes.lock.on") : t("themes.lock.off")}
            </span>
            <span className="qcms-appearance__track" aria-hidden="true" />
          </SwitchButton>
        </SwitchField>
        <p className="text-xs text-(--color-text-muted)">{t("themes.lock.help")}</p>
        {!canSetLock && (
          <p id={LOCK_REASON_ID} className="text-xs text-(--color-text-muted)">
            {t("themes.lock.needs")}
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="text-base font-semibold text-(--color-text)">{t("themes.list")}</h3>
        {!canEditForms && (
          <p id={THEME_REASON_ID} className="text-xs text-(--color-text-muted)">
            {t("themes.needs")}
          </p>
        )}
        {list()}
        <p className="text-xs text-(--color-text-muted)">{t("themes.create.note")}</p>
      </div>
    </section>
  );
}
