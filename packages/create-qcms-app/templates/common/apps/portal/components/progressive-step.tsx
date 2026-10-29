"use client";

import { useEffect, useState } from "react";

import { NativeStep } from "@/components/native-step";
import { StepFlow } from "@/components/step-flow";
import type { StepResponse } from "@/lib/server/api";
import type { StepContext } from "@/lib/server/route-helpers";

/**
 * Progressive enhancement for the flow page. The client's first render is also
 * {@link NativeStep}, so hydration matches the server HTML; a mount effect then flips to
 * {@link StepFlow}. Exactly one form is live at a time, so there is no double submit.
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
  readonly opToken: string;
  /**
   * A prop and not a derivation: a client component cannot read the request header the
   * proxy resolved the environment on, and parsing `window.location` would make every
   * address depend on the one the browser happens to be at (Q21).
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
