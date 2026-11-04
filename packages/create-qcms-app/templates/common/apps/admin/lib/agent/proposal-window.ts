"use client";

import { useEffect } from "react";

import type { AgentProposal } from "../forms/assist-stream.ts";

import { proposalWindowMs } from "./plan-state.ts";

/** Use elapsed monotonic time so browser clock corrections cannot change the waiting window. The API independently enforces token expiry. */

export interface ProposalWindow {
  readonly startedAt: number;
  readonly totalMs: number;
}

export function monotonicNow(): number {
  return performance.now();
}

export function remainingWindowMs(span: ProposalWindow, now: number): number {
  return Math.max(0, span.totalMs - (now - span.startedAt));
}

export function startedWindow(proposal: AgentProposal): ProposalWindow {
  return { startedAt: monotonicNow(), totalMs: proposalWindowMs(proposal) };
}

export function useExpiryTick(span: ProposalWindow, waiting: boolean, onExpire: () => void): void {
  const { startedAt, totalMs } = span;
  useEffect(() => {
    if (!waiting) return undefined;
    const left = remainingWindowMs({ startedAt, totalMs }, monotonicNow());
    const timer = window.setTimeout(onExpire, left);
    return () => {
      window.clearTimeout(timer);
    };
  }, [onExpire, startedAt, totalMs, waiting]);
}
