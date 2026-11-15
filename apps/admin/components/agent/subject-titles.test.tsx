import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AgentPlanStep, AgentProposal } from "@/lib/forms/assist-stream";

const asked = vi.hoisted((): { calls: string[][] } => ({ calls: [] }));

vi.mock("@/app/(shell)/assist/titles", () => ({
  readSubjectTitlesAction: (ids: string[]) => {
    asked.calls.push(ids);
    return Promise.resolve(ids.includes("q_full_name") ? { q_full_name: "Full name" } : {});
  },
}));

const { useSubjectTitles } = await import("./subject-titles");

function proposalFor(ids: readonly string[]): AgentProposal {
  const steps = ids.map((questionId): AgentPlanStep => ({
    kind: "question.publish",
    screen: "/questions/[questionId]",
    args: { questionId, version: 1 },
    environment: "test",
    handOff: false,
    local: false,
    card: { titleKey: "agent.card.question.publish.title", consequenceKeys: [] },
    resultAllowlist: [],
  }));
  return { proposalId: "prp_1", steps, expiresAt: "", windowMs: 0 } as unknown as AgentProposal;
}

describe("the titles a card looks up for itself", () => {
  it("asks once for the ids the screen does not already know", async () => {
    asked.calls = [];
    const known = new Map([["frm_a", "Larkmead new patient sign-up"]]);
    const { result, rerender } = renderHook(() =>
      useSubjectTitles(proposalFor(["q_full_name"]), known),
    );

    await waitFor(() => {
      expect(result.current?.get("q_full_name")).toBe("Full name");
    });
    rerender();
    expect(asked.calls).toEqual([["q_full_name"]]);
    expect(result.current?.get("frm_a")).toBe("Larkmead new patient sign-up");
  });

  it("asks no second time for an id the lists do not name", async () => {
    asked.calls = [];
    const { result, rerender } = renderHook(() =>
      useSubjectTitles(proposalFor(["q_missing"]), undefined),
    );

    await waitFor(() => {
      expect(asked.calls).toEqual([["q_missing"]]);
    });
    rerender();
    expect(asked.calls).toEqual([["q_missing"]]);
    expect(result.current).toBeUndefined();
  });
});
