"use client";

import { useState, useTransition, type FormEvent } from "react";

import { useEnvironmentUnknown } from "@/components/environment-scope";
import { Alert, Button, TextField } from "@/components/kit";
import { EraseDialog } from "@/components/ops/erase-dialog";
import { ErasureElsewhereOffer } from "@/components/ops/erasure-elsewhere";
import { TombstoneCard } from "@/components/ops/tombstone-card";
import { announce } from "@/lib/announce";
import { t } from "@/lib/i18n/en";
import type { ErasureReason } from "@/lib/ops/erasure";
import { knownTargetStep, type KnownTargetLookup } from "@/lib/ops/known-target";
import { requestPostActionFocus, TOMBSTONE_HEADING_ID } from "@/lib/ops/post-action-focus";
import type { EraseOutcome } from "@/lib/ops/types";
import { unexpected } from "@/lib/ops/unexpected";

/**
 * Erasing one session named by its id, for an eraser who may hold no response read. The
 * lookup says only whether the session exists here, and the act is the response detail's
 * own type-to-confirm erasure.
 */
export function KnownTargetErasure({
  environment,
  lookup,
  erase,
  secureCookies,
}: {
  readonly environment: string;
  readonly lookup: (sessionId: string) => Promise<KnownTargetLookup>;
  readonly erase: (
    sessionId: string,
    reason: ErasureReason,
  ) => Promise<{
    readonly status: "erased" | "error";
    readonly data?: EraseOutcome;
    readonly message?: string;
  }>;
  readonly secureCookies: boolean;
}) {
  const [typed, setTyped] = useState("");
  const [required, setRequired] = useState(false);
  const [found, setFound] = useState<KnownTargetLookup | null>(null);
  const [target, setTarget] = useState("");
  const [dialog, setDialog] = useState(false);
  const [erased, setErased] = useState<EraseOutcome | null>(null);
  const [eraseError, setEraseError] = useState<string | undefined>(undefined);
  const [isPending, startTransition] = useTransition();
  const environmentUnknown = useEnvironmentUnknown();

  const step = knownTargetStep(found, erased !== null);

  function find(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const sessionId = typed.trim();
    if (sessionId === "") {
      setRequired(true);
      return;
    }
    setRequired(false);
    setErased(null);
    startTransition(() => {
      void lookup(sessionId)
        .then((state) => {
          setTarget(sessionId);
          setFound(state);
        })
        .catch(() => {
          setFound({ status: "error", message: unexpected() });
        });
    });
  }

  function runErase(reason: ErasureReason): void {
    setEraseError(undefined);
    startTransition(() => {
      void erase(target, reason)
        .then((state) => {
          if (state.status === "error" || state.data === undefined) {
            setEraseError(t("ops.erase.failed", { message: state.message ?? "" }));
            return;
          }
          requestPostActionFocus(TOMBSTONE_HEADING_ID, target);
          setErased(state.data);
          setDialog(false);
          announce(
            state.data.alreadyErased
              ? t("ops.erase.alreadyErased")
              : t("ops.erase.done", { sessionId: target }),
          );
        })
        .catch(() => {
          setEraseError(t("ops.erase.failed", { message: unexpected() }));
        });
    });
  }

  const others = found?.status === "found" ? found.scope.otherEnvironments : [];

  return (
    <section className="flex flex-col gap-4" data-testid="qcms-known-target-erasure">
      <form className="flex flex-col items-start gap-3" onSubmit={find} noValidate>
        <TextField
          label={t("ops.erase.known.sessionLabel")}
          value={typed}
          isInvalid={required}
          errorMessage={t("ops.erase.known.required")}
          onChange={(next) => {
            setTyped(next);
            setFound(null);
            setErased(null);
          }}
        />
        <Button type="submit" variant="secondary" size="md" isDisabled={isPending}>
          {isPending && !dialog ? t("ops.common.working") : t("ops.erase.known.find")}
        </Button>
      </form>

      <div aria-live="polite" className="flex flex-col gap-3" data-testid="qcms-known-target-status">
        {step === "missing" && (
          <Alert variant="info">
            {t("ops.erase.known.missing", { sessionId: target, environment })}
          </Alert>
        )}
        {step === "failed" && found?.status === "error" && (
          <Alert variant="error">
            {t("ops.erase.known.lookupFailed", { message: found.message })}
          </Alert>
        )}
        {step === "alreadyErased" && <Alert variant="info">{t("ops.erase.alreadyErased")}</Alert>}
        {step === "erasable" && (
          <p className="text-sm text-(--color-text)" data-testid="qcms-known-target-found">
            {t("ops.erase.known.found", { sessionId: target, environment })}
          </p>
        )}
        {step === "erased" && erased !== null && (
          <Alert variant="success">
            {erased.alreadyErased
              ? t("ops.erase.alreadyErased")
              : t("ops.erase.done", { sessionId: target })}
          </Alert>
        )}
      </div>

      {step === "erasable" && (
        <div>
          <Button
            variant="danger"
            size="md"
            isDisabled={isPending || environmentUnknown}
            onPress={() => {
              setEraseError(undefined);
              setDialog(true);
            }}
          >
            {t("ops.erase.button")}
          </Button>
        </div>
      )}

      {step === "erased" && erased !== null && <TombstoneCard tombstone={erased} />}
      {(step === "erased" || step === "alreadyErased" || step === "erasable") && (
        <ErasureElsewhereOffer others={others} secureCookies={secureCookies} />
      )}

      {dialog && (
        <EraseDialog
          sessionId={target}
          environment={environment}
          isPending={isPending}
          error={eraseError}
          onConfirm={runErase}
          onClose={() => {
            setDialog(false);
          }}
        />
      )}
    </section>
  );
}
