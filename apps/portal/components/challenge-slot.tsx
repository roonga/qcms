import dynamic from "next/dynamic";

import { challengeProvider, turnstileSiteKey } from "@/lib/server/challenge";

// Load the widget dynamically so the default provider ships no client bundle or external script.
const TurnstileWidget = dynamic(() =>
  import("@/components/turnstile-widget").then((mod) => mod.TurnstileWidget),
);

export function ChallengeSlot() {
  if (challengeProvider() !== "turnstile") return null;
  const siteKey = turnstileSiteKey();
  if (siteKey === undefined) return null;
  return <TurnstileWidget siteKey={siteKey} />;
}
