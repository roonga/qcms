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
}: {
  readonly sessionId: string;
  readonly initial: StepResponse;
  readonly context?: StepContext | undefined;
}) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  if (hydrated) {
    return <StepFlow sessionId={sessionId} initial={initial} />;
  }
  return <NativeStep sessionId={sessionId} initial={initial} context={context} />;
}
