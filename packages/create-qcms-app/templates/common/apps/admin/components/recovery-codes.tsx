"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { copyRecoveryCodes } from "@/lib/recovery-copy";

export function RecoveryCodes({ codes }: { readonly codes: readonly string[] }) {
  const [note, setNote] = useState("");

  const copy = useCallback(() => {
    const clipboard: Clipboard | undefined = navigator.clipboard;
    // copyRecoveryCodes resolves every outcome and never rejects; no rejection handler can be reached.
    // eslint-disable-next-line qcms/no-unhandled-then -- copyRecoveryCodes never rejects; see above
    void copyRecoveryCodes(clipboard, codes).then((outcome) => {
      setNote(outcome === "copied" ? t("recovery.copied") : t("recovery.copyFailed"));
    });
  }, [codes]);

  return (
    <>
      <ul
        aria-label={t("recovery.listLabel")}
        className="grid grid-cols-2 gap-2 rounded border border-(--color-border) bg-(--color-background-muted) p-3 font-mono text-sm tabular-nums text-(--color-text)"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onPress={copy}>
          {t("recovery.copy")}
        </Button>
        <p
          aria-live="polite"
          data-testid="qcms-recovery-copy-status"
          className="text-sm text-(--color-text-muted)"
        >
          {note}
        </p>
      </div>
    </>
  );
}
