"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

import { TURNSTILE_ORIGIN } from "@/lib/turnstile";

/**
 * Cloudflare Turnstile widget shell (ADR-24). `ChallengeSlot` gates it, so with the
 * default provider this module is never loaded and its script origin never appears
 * (SEC-9). The API verifies the token; the portal never does.
 */
export function TurnstileWidget({ siteKey }: { readonly siteKey: string }) {
  const [token, setToken] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    container.dataset.callbackReady = "1";
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <Script src={`${TURNSTILE_ORIGIN}/turnstile/v0/api.js`} strategy="afterInteractive" />
      <div
        ref={containerRef}
        className="cf-turnstile"
        data-sitekey={siteKey}
        data-callback="qcmsTurnstileCallback"
        suppressHydrationWarning
      />
      <TurnstileBridge onToken={setToken} />
      <input type="hidden" name="challengeToken" value={token} readOnly />
    </div>
  );
}

// Bridges Turnstile's global data-callback to React state without inline JS, which the
// CSP would refuse.
function TurnstileBridge({ onToken }: { readonly onToken: (token: string) => void }) {
  useEffect(() => {
    const win = window as unknown as { qcmsTurnstileCallback?: (token: string) => void };
    win.qcmsTurnstileCallback = (value: string) => {
      onToken(value);
    };
    return () => {
      delete win.qcmsTurnstileCallback;
    };
  }, [onToken]);
  return null;
}
