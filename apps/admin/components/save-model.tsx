"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useOperatorDateTimeFormat } from "@/components/operator-time";
import { t, type MessageKey } from "@/lib/i18n/en";
import { formatUtcDateTimeForTests } from "@/lib/i18n/format";

/* Track storage separately from validation; a failed second round trip must not report a save that already
   succeeded as failed. */
export function AmbientSaveStatus({
  isSaving,
  hasFailed,
  savedAt,
}: {
  readonly isSaving: boolean;
  readonly hasFailed: boolean;
  readonly savedAt: string | undefined;
}) {
  const [modelOpen, setModelOpen] = useState(false);
  const modelId = useId();
  const formatSavedAt = useOperatorDateTimeFormat();
  return (
    <div className="relative flex flex-col items-end">
      <p
        data-testid="qcms-save-status"
        data-saved-at={savedAt}
        className="flex items-baseline justify-end gap-x-2 text-sm text-(--color-text-muted)"
      >
        <span aria-live="polite" data-testid="qcms-save-state">
          {isSaving ? t("forms.save.saving") : settledSaveState(hasFailed, savedAt, formatSavedAt)}
        </span>
        {/* Keep help outside the live region so opening it cannot interrupt the settled save announcement. */}
        {/* Keep the help trigger in a stable row so changing save text cannot move it under the pointer. */}
        <button
          type="button"
          className="qcms-help-dot"
          aria-expanded={modelOpen}
          aria-controls={modelId}
          aria-label={t("forms.save.modelLabel")}
          onClick={() => {
            setModelOpen((wasOpen) => !wasOpen);
          }}
        >
          <span aria-hidden="true">{"?"}</span>
        </button>
      </p>
      {modelOpen && (
        <p
          id={modelId}
          data-testid="qcms-save-model"
          className="absolute top-full right-0 z-10 mt-1 w-max max-w-measure-narrow rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-end text-sm text-(--color-text) shadow-lg"
        >
          {t("forms.save.model")}
        </p>
      )}
    </div>
  );
}

function settledSaveState(
  hasFailed: boolean,
  savedAt: string | undefined,
  formatSavedAt: (
    iso: string | null | undefined,
    fallback?: string,
  ) => string = formatUtcDateTimeForTests,
): string {
  if (hasFailed) return t("forms.save.failed");
  if (savedAt !== undefined) return t("forms.save.saved", { time: formatSavedAt(savedAt) });
  return t("forms.save.idle");
}

/* Place the manual-save note before its button in DOM order; do not add ambient autosave chrome to
   manual-save screens. */
export function ManualSaveNote({ messageKey }: { readonly messageKey: MessageKey }) {
  return (
    <p data-testid="qcms-manual-save-note" className="text-sm text-(--color-text-muted)">
      {t(messageKey)}
    </p>
  );
}

export function AutosaveFlash({ savedAt }: { readonly savedAt: string | undefined }) {
  const [visible, setVisible] = useState(false);
  // A mount is not a save event; do not flash confirmation for a save that landed on another screen earlier.
  const acknowledged = useRef(savedAt);

  useEffect(() => {
    if (savedAt === undefined || savedAt === acknowledged.current) return undefined;
    acknowledged.current = savedAt;
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
    }, FLASH_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [savedAt]);

  if (!visible) return null;
  return (
    <span className="qcms-autosave-flash" data-testid="qcms-autosave-flash" aria-hidden="true">
      {t("forms.save.flash")}
    </span>
  );
}

const FLASH_MS = 1800;
