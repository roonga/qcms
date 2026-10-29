import dynamic from "next/dynamic";

import { challengeProvider, turnstileSiteKey } from "@/lib/server/challenge";

// Dynamically imported so the widget's client bundle only ships when the provider is on
// (SEC-9).
const TurnstileWidget = dynamic(() =>
  import("@/components/turnstile-widget").then((mod) => mod.TurnstileWidget),
);

export function ChallengeSlot() {
  if (challengeProvider() !== "turnstile") return null;
  const siteKey = turnstileSiteKey();
  if (siteKey === undefined) return null;
  return <TurnstileWidget siteKey={siteKey} />;
}
