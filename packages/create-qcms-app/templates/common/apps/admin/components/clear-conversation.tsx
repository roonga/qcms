"use client";

import { useEffect } from "react";

import { clearStoredConversation } from "@/lib/agent/conversation";

/**
 * Drops this tab's stored conversation on a screen that means the session is over. The
 * account menu clears it on its way out, but an expiry or any other arrival here does not
 * pass through that menu, and the dialogue would sit in the tab until the next sign-in.
 */
export function ClearStoredConversation() {
  useEffect(() => {
    clearStoredConversation();
  }, []);
  return null;
}
