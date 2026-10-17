"use client";

import { useEffect, useState } from "react";

import { NativeStep } from "@/components/native-step";
import { StepFlow } from "@/components/step-flow";
import type { StepResponse } from "@/lib/server/api";
import type { StepContext } from "@/lib/server/route-helpers";

/**
 * Progressive enhancement for the flow page (task 044).
 *
 * The SSR paints {@link NativeStep} - a real, natively-submittable
 * `<form method="post">` that works with JavaScript disabled. On the client the
 * first render is ALSO `NativeStep` (so hydration matches the server HTML exactly,
 * no mismatch), then a mount effect flips to the existing controlled
 * {@link StepFlow} (029/030), unmounting the native form. So exactly one form is
 * live at a time: JS-off keeps the native POST form; JS-on gets the unchanged
 * per-answer controlled path - no double-submit, no regression.
 *
 * `StepResponse` / `StepContext` are imported type-only, so this client component
 * pulls no server module into the browser bundle (R2 import-surface test).
 */
export function ProgressiveStep({
  sessionId,
  initial,
  context,
  opToken,
  basePath,
}: {
  readonly sessionId: string;
  readonly initial: StepResponse;
  readonly context?: StepContext | undefined;
  /** The one-time roster-operation token this page render minted (task 073). */
  readonly opToken: string;
  /**
   * The environment's address prefix: `""` for `prod` and `/<env>` for every other
   * (Q21, task 066).
   *
   * **A prop and not a derivation.** A client component cannot read the request header
   * the proxy resolved the environment on, and reading it back out of
   * `window.location` would make every address below depend on parsing the one the
   * browser happens to be at. The page that already knows it passes it down, so a
   * `fetch` from a `test` session's page reaches `test`'s route rather than `prod`'s -
   * which would answer, and would answer about a session that is a schema away.
   */
  readonly basePath: string;
}) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  if (hydrated) {
    return <StepFlow sessionId={sessionId} initial={initial} basePath={basePath} />;
  }
  return (
    <NativeStep
      sessionId={sessionId}
      initial={initial}
      context={context}
      opToken={opToken}
      basePath={basePath}
    />
  );
}
