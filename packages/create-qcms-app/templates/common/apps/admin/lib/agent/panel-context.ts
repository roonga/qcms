"use client";

import { createContext, useContext, type RefObject } from "react";

import type { ResolvedScreen } from "./screens";

/** Keep shared context outside the panel module to avoid its import cycle with the sidebar toggle. */

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

export function useAssistant(): AssistantControl | undefined {
  return useContext(AssistantContext);
}
