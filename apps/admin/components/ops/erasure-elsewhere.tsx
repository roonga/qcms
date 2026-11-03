"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Alert, Button } from "@/components/kit";
import { environmentCookie } from "@/lib/environment";
import { t } from "@/lib/i18n/en";
import type { ErasureElsewhere } from "@/lib/ops/types";

/* This offer only switches environment and refreshes. Erasure requires that destination's own
   type-to-confirm action. */
export function ErasureElsewhereOffer({
  others,
  secureCookies,
}: {
  readonly others: readonly ErasureElsewhere[];
  readonly secureCookies: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (others.length === 0) return null;

  const go = (environment: string): void => {
    document.cookie = environmentCookie(environment, secureCookies);
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <Alert variant="warning">
      <div
        className="flex flex-col gap-3"
        data-testid="qcms-erasure-elsewhere"
        data-pending={isPending ? "true" : "false"}
      >
        <p className="font-semibold">{t("ops.erase.elsewhere.title")}</p>
        <p>{t("ops.erase.elsewhere.body")}</p>
        <ul className="flex flex-col gap-2">
          {others.map((other) => (
            <li key={other.environment} className="flex flex-wrap items-center gap-3">
              <span data-testid={`qcms-erasure-elsewhere-${other.environment}`}>
                {other.alreadyErased
                  ? t("ops.erase.elsewhere.done", { environment: other.environment })
                  : t("ops.erase.elsewhere.pending", { environment: other.environment })}
              </span>
              <Button
                variant="secondary"
                isDisabled={isPending}
                onPress={() => {
                  go(other.environment);
                }}
              >
                {t("ops.erase.elsewhere.go", { environment: other.environment })}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </Alert>
  );
}
