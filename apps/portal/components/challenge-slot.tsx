import dynamic from "next/dynamic";

import { challengeProvider, turnstileSiteKey } from "@/lib/server/challenge";

/**
 * Pre-session challenge slot (wireframe `challenge slot`, entry pages only). With
 * the default provider `none` this renders nothing and the Turnstile chunk is
 * never referenced, so no challenge code loads (SEC-9). It is dynamically imported
 * so the widget's client bundle only ships when the flag is on.
 */
const TurnstileWidget = dynamic(() =>
  import("@/components/turnstile-widget").then((mod) => mod.TurnstileWidget),
);

export function ChallengeSlot() {
  if (challengeProvider() !== "turnstile") return null;
  const siteKey = turnstileSiteKey();
  if (siteKey === undefined) return null;
  return <TurnstileWidget siteKey={siteKey} />;
}
