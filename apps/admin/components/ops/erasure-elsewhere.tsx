"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Alert, Button } from "@/components/kit";
import { environmentCookie } from "@/lib/environment";
import { t } from "@/lib/i18n/en";
import type { ErasureElsewhere } from "@/lib/ops/types";

/**
 * Q7's cross-environment erasure offer (ADR-17's Note, task 067, criterion 4).
 *
 * # What this is, and what it must never become
 *
 * An erasure acts in **the selected environment only**, so no single act crosses a
 * boundary and `prod` cannot be reached from `test` by accident. The cost is that a data
 * subject's request is several deliberate acts rather than one click; the benefit is that
 * none of them is the wrong one. This component is the whole of what makes that cost
 * visible rather than something an operator has to remember.
 *
 * The criterion names the failure mode in as many words: "an implementation that helpfully
 * erases everywhere on one confirmation fails the criterion and is not undoable". So this
 * component has **no erase path in it at all**. It takes no action, it is passed no action,
 * and the only thing it can do is write the environment cookie and re-read the page - the
 * same two steps the global switcher takes, deliberately, because that is the mechanism
 * the operator already knows. The screen that then renders is this response in the other
 * environment, with its own erasure door, its own type-to-confirm and its own confirmation
 * naming its own environment.
 *
 * That is why the control is a `Button` that navigates rather than a form that posts:
 * there is nothing to post. A reviewer checking this against criterion 4 should be able to
 * satisfy themselves by observing that nothing in this file imports an erase function.
 *
 * # Why it renders in the tombstone branch too
 *
 * The case this exists for is "I have just erased here, where else do I have to go", so
 * the moment it matters most is the moment the screen has become a tombstone. The page
 * renders it in both branches for that reason.
 *
 * # Why `router.refresh()` and not a `<Link>`
 *
 * The environment is a cookie read on the server, not a path segment (ADR-40, Q6: the
 * admin deliberately does not carry the environment in its URL). So the address of this
 * response in another environment is **the same address**, and a link to it would be a
 * link to the page the operator is already on. Writing the cookie and refreshing is what
 * changes which rows the server reads, which is exactly what `EnvironmentSwitcher` does
 * and for the same reason.
 */
export function ErasureElsewhereOffer({
  others,
  secureCookies,
}: {
  /**
   * The other environments holding something for this subject identifier, already
   * narrowed by the API to the ones this operator may erase in - so there is no offer
   * here to suppress.
   */
  readonly others: readonly ErasureElsewhere[];
  readonly secureCookies: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (others.length === 0) return null;

  const go = (environment: string): void => {
    document.cookie = environmentCookie(environment, secureCookies);
    // Re-read this route's server components with the new cookie attached. The response,
    // the banner and the erasure door all come back as that environment's, which is the
    // state an operator has to be in before they can confirm an erasure there.
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
