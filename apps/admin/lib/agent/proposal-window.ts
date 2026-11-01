"use client";

import { useEffect } from "react";

import type { AgentProposal } from "../forms/assist-stream.ts";

import { proposalWindowMs } from "./plan-state.ts";

/**
 * A card's waiting window, counted from the moment the card arrived in the browser.
 *
 * The server sets the window's length; the card takes that length and counts it on a
 * monotonic clock from arrival, so a browser whose own clock is out by more than the
 * window cannot make a card arrive expired. The API stays the authority either way: it
 * refuses a token past its own `exp` whatever the card shows.
 */

export interface ProposalWindow {
  /** A monotonic reading taken when the card arrived. */
  readonly startedAt: number;
  readonly totalMs: number;
}

/** The monotonic clock the window counts on, which no clock correction moves. */
export function monotonicNow(): number {
  return performance.now();
}

export function remainingWindowMs(span: ProposalWindow, now: number): number {
  return Math.max(0, span.totalMs - (now - span.startedAt));
}

/** The window a card that has just arrived counts, starting now. */
export function startedWindow(proposal: AgentProposal): ProposalWindow {
  return { startedAt: monotonicNow(), totalMs: proposalWindowMs(proposal) };
}

/**
 * Flips a waiting card to Expired when its window runs out. Armed only while the card
 * waits, so a confirmed or cancelled card never ticks, and cleared on unmount.
 */
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
