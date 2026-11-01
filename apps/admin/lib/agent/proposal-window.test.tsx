import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentProposal } from "../forms/assist-stream.ts";

import { proposalWindowMs } from "./plan-state.ts";
import { remainingWindowMs, startedWindow, useExpiryTick } from "./proposal-window.ts";

/**
 * The window a card waits in is the server's length counted from arrival on a monotonic
 * clock. What is asserted here is that the browser's own clock cannot move it, and that
 * the tick runs once, only while the card waits.
 */

const PROPOSAL: AgentProposal = {
  proposalId: "prp_window",
  token: "tok",
  steps: [],
  proposedAt: "2026-07-20T00:00:00.000Z",
  expiresAt: "2026-07-20T00:10:00.000Z",
  formId: undefined,
  currentEnvironment: "test",
};

function Ticker({
  waiting,
  onExpire,
}: {
  readonly waiting: boolean;
  readonly onExpire: () => void;
}) {
  useExpiryTick({ startedAt: 0, totalMs: proposalWindowMs(PROPOSAL) }, waiting, onExpire);
  return null;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the window's length", () => {
  it("is the server's own, whatever the browser's clock says", () => {
    vi.useFakeTimers({ now: Date.parse("2027-01-01T00:00:00.000Z") });
    const started = startedWindow(PROPOSAL);
    expect(started.totalMs).toBe(10 * 60 * 1000);
    expect(remainingWindowMs(started, started.startedAt)).toBe(10 * 60 * 1000);
  });

  it("counts down from arrival and never below zero", () => {
    const span = { startedAt: 1_000, totalMs: 60_000 };
    expect(remainingWindowMs(span, 31_000)).toBe(30_000);
    expect(remainingWindowMs(span, 200_000)).toBe(0);
  });
});

describe("the tick", () => {
  it("expires a waiting card when the window runs out", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    render(<Ticker waiting onExpire={onExpire} />);

    vi.advanceTimersByTime(10 * 60 * 1000 - 1);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("does not tick once the card has been confirmed or cancelled", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const view = render(<Ticker waiting onExpire={onExpire} />);

    view.rerender(<Ticker waiting={false} onExpire={onExpire} />);
    vi.advanceTimersByTime(60 * 60 * 1000);

    expect(onExpire).not.toHaveBeenCalled();
  });

  it("does not tick after the card has gone", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const view = render(<Ticker waiting onExpire={onExpire} />);

    view.unmount();
    vi.advanceTimersByTime(60 * 60 * 1000);

    expect(onExpire).not.toHaveBeenCalled();
  });
});
