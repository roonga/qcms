import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentTurnRecord, ConversationHandle } from "@/lib/agent/conversation";
import type { ResolvedScreen } from "@/lib/agent/screens";
import { t } from "@/lib/i18n/en";

import { AssistantConversation } from "./assistant-conversation";

/* The quote on a card belongs to the turn that proposed it. A later turn is about something
   else, so its prose must not take the card's place. */

const SCREEN: ResolvedScreen = { screen: "/forms", params: {} };

const WHY = "Three of these questions are new, so they have to be published first.";
const LATER = "The card is still waiting, so nothing has run yet.";

const PLAN = {
  proposalId: "prp_one",
  token: "tok",
  steps: [
    {
      kind: "link.mint",
      screen: "/operations/forms/[formId]/links",
      args: { formId: "frm_quote", count: 1, expiresAt: "2026-11-30T23:59:59.000Z" },
      environment: "test",
      local: false,
      handOff: false,
      card: { titleKey: "agent.card.link.mint.title", consequenceKeys: [] },
      resultAllowlist: ["count", "environment"],
    },
  ],
  proposedAt: "2026-11-02T10:00:00.000Z",
  expiresAt: "2026-11-02T10:10:00.000Z",
  formId: "frm_quote",
  currentEnvironment: "test",
};

function frame(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`;
}

function stream(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

let turns: readonly AgentTurnRecord[] = [];

function handle(): ConversationHandle {
  turns = [];
  return {
    id: "cnv_1",
    visitId: "vis_1",
    subject: "Quote",
    turns,
    dropped: 0,
    current: () => turns,
    append: (next) => {
      turns = [...turns, ...next];
    },
    restart: () => undefined,
  };
}

function say(message: string): void {
  const composer = screen.getByTestId("qcms-assistant-composer");
  fireEvent.change(composer, { target: { value: message } });
  fireEvent.keyDown(composer, { key: "Enter" });
}

function quoted(): string | undefined {
  return document.querySelector(".qcms-acard__reason q")?.textContent ?? undefined;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the reason a card quotes", () => {
  function mount(bodies: readonly string[]): void {
    let at = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        const body = bodies[at] ?? "";
        at += 1;
        return Promise.resolve(stream(body));
      }),
    );
    render(
      <AssistantConversation
        screen={SCREEN}
        environment="test"
        conversation={handle()}
        builder={undefined}
        composerRef={{ current: null }}
        onWorkingChange={() => undefined}
        onAnnounce={() => undefined}
      />,
    );
  }

  it("quotes the sentence the turn that proposed it wrote", async () => {
    mount([frame("text", { delta: WHY }) + frame("plan", { proposal: PLAN })]);
    say("give me a link");
    await vi.waitFor(() => {
      expect(quoted()).toBe(WHY);
    });
  });

  it("keeps that sentence when a later turn proposes no card of its own", async () => {
    mount([
      frame("text", { delta: WHY }) + frame("plan", { proposal: PLAN }),
      frame("text", { delta: LATER }),
    ]);
    say("give me a link");
    await vi.waitFor(() => {
      expect(quoted()).toBe(WHY);
    });

    say("did that go through?");
    await vi.waitFor(() => {
      expect(screen.getByTestId("qcms-assistant-turns").textContent).toContain(LATER);
    });

    // The card is the same card, so it still says why it is there.
    expect(screen.getAllByRole("button", { name: t("agent.card.confirm") }).length).toBe(1);
    expect(quoted()).toBe(WHY);
  });

  it("takes the new turn's sentence when that turn does propose a card", async () => {
    const second = { ...PLAN, proposalId: "prp_two" };
    mount([
      frame("text", { delta: WHY }) + frame("plan", { proposal: PLAN }),
      frame("text", { delta: LATER }) + frame("plan", { proposal: second }),
    ]);
    say("give me a link");
    await vi.waitFor(() => {
      expect(quoted()).toBe(WHY);
    });

    say("make it two");
    await vi.waitFor(() => {
      expect(quoted()).toBe(LATER);
    });
  });
});
