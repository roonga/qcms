"use client";

import { createContext, useContext, type RefObject } from "react";

import type { ResolvedScreen } from "./screens";

/**
 * The assistant's shared state, in a module of its own.
 *
 * The top-bar button, the panel and the rail's "Show sidebar" all read it, and the last of
 * those lives in `components/sidebar-toggle.tsx`, which the panel itself imports. A context
 * declared in the panel's own module would make that pair a cycle, so the context is here
 * and both sides import it.
 */

/** The dock, the modal expanded state, or the sheet below `--bp-sidebar`. */
export type AssistantMode = "dock" | "expanded" | "sheet";

export interface AssistantControl {
  readonly open: boolean;
  readonly mode: AssistantMode;
  readonly width: number;
  readonly working: boolean;
  readonly announcement: string;
  readonly screen: ResolvedScreen | undefined;
  readonly show: () => void;
  readonly close: () => void;
  readonly toggleExpanded: () => void;
  readonly resize: (width: number) => void;
  readonly setWorking: (working: boolean) => void;
  readonly announce: (message: string) => void;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
}

export const AssistantContext = createContext<AssistantControl | undefined>(undefined);

/** The control, or `undefined` where the assistant is not mounted at all (the flag is off). */
export function useAssistant(): AssistantControl | undefined {
  return useContext(AssistantContext);
}
