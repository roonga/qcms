"use client";

import { useState } from "react";

import { Alert, Button, Dialog, Select, TextField } from "@/components/kit";
import type { ErasureReason } from "@/lib/ops/erasure";
import { DEFAULT_ERASURE_REASON, ERASURE_REASONS, isErasureConfirmed } from "@/lib/ops/erasure";
import { t } from "@/lib/i18n/en";

/** The type-to-confirm erasure of one session in one environment, which names that environment. */
export function EraseDialog({
  sessionId,
  environment,
  isPending,
  error,
  onConfirm,
  onClose,
}: {
  readonly sessionId: string;
  readonly environment: string;
  readonly isPending: boolean;
  readonly error?: string | undefined;
  readonly onConfirm: (reason: ErasureReason) => void;
  readonly onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState<ErasureReason>(DEFAULT_ERASURE_REASON);
  const confirmed = isErasureConfirmed(typed, sessionId);

  return (
    <Dialog
      isOpen
      role="alertdialog"
      title={t("ops.erase.title")}
      isDismissable={!isPending}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <div className="flex flex-col gap-4" data-testid="qcms-erase-dialog">
        <p className="text-sm text-(--color-text)">{t("ops.erase.irreversible")}</p>
        <p className="text-sm text-(--color-text)">{t("ops.erase.tombstoneStays")}</p>
        <p className="text-sm text-(--color-text)">{t("ops.erase.consumersUnaffected")}</p>
        <p className="text-sm font-semibold" data-testid="qcms-erase-environment">
          {t("environment.inThis", { environment })}
        </p>
        <Select
          label={t("ops.erase.reason")}
          value={reason}
          items={ERASURE_REASONS.map((entry) => ({
            label: t(`ops.erase.reason.${entry}`),
            value: entry,
          }))}
          onChange={(next) => {
            setReason(next as ErasureReason);
          }}
        />
        <TextField
          label={t("ops.erase.confirmLabel")}
          description={t("ops.erase.confirmHint", { sessionId })}
          value={typed}
          isInvalid={typed !== "" && !confirmed}
          errorMessage={t("ops.erase.mismatch")}
          onChange={setTyped}
        />
        {error !== undefined && <Alert variant="error">{error}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="danger"
            size="md"
            isDisabled={!confirmed || isPending}
            onPress={() => {
              onConfirm(reason);
            }}
          >
            {isPending ? t("ops.common.working") : t("ops.erase.confirm")}
          </Button>
          <Button variant="ghost" size="md" isDisabled={isPending} onPress={onClose}>
            {t("ops.common.cancel")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
