import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentTurnRecord, ConversationHandle } from "@/lib/agent/conversation";
import type { AgentProposal } from "@/lib/forms/assist-stream";
import type { ResolvedScreen } from "@/lib/agent/screens";
import { t } from "@/lib/i18n/en";

const revealed: HTMLElement[] = [];

vi.mock("@/lib/agent/panel-scroll", () => ({
  revealIn: (_list: HTMLElement, item: HTMLElement): void => {
    revealed.push(item);
  },
  revealOffset: () => 0,
}));

vi.mock("@/lib/agent/builder-assist-bridge", () => ({
  builderAssistSnapshot: () => undefined,
  nextDraftSaved: (): Promise<string | undefined> => Promise.resolve(undefined),
  recordDraftSaved: () => undefined,
  useBuilderAssist: () => undefined,
  usePublishBuilderAssist: () => undefined,
}));

const { AssistantConversation } = await import("./assistant-conversation");

const SCREEN: ResolvedScreen = { screen: "/forms", params: {} };

const PROPOSAL: AgentProposal = {
  proposalId: "prp_publish",
  token: "tok",
  steps: [
    {
      kind: "form.publish",
      screen: "/forms/[formId]",
      args: { formId: "frm_quote" },
      environment: "test",
      handOff: false,
      local: false,
      card: { titleKey: "agent.card.form.publish.title", consequenceKeys: [] },
      resultAllowlist: ["version", "environment"],
    },
  ],
  proposedAt: "2026-11-02T10:00:00.000Z",
  expiresAt: "2026-11-02T10:10:00.000Z",
  formId: "frm_quote",
  currentEnvironment: "test",
};

function conversationHandle(): ConversationHandle {
  let turns: readonly AgentTurnRecord[] = [];
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

function stream(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function textStream(text: string): Response {
  return stream(`event: text\ndata: ${JSON.stringify({ type: "text", delta: text })}\n\n`);
}

function say(message: string): void {
  const composer = screen.getByTestId("qcms-assistant-composer");
  fireEvent.change(composer, { target: { value: message } });
  fireEvent.keyDown(composer, { key: "Enter" });
}

beforeEach(() => {
  revealed.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("where the assistant panel leaves the reader", () => {
  it("follows the newest reply, not the settled card the list keeps below it", async () => {
    const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>();
    fetchMock.mockResolvedValueOnce(
      stream(`event: plan\ndata: ${JSON.stringify({ type: "plan", proposal: PROPOSAL })}\n\n`),
    );
    fetchMock.mockResolvedValue(textStream("Nothing needs changing."));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AssistantConversation
        screen={SCREEN}
        environment="test"
        conversation={conversationHandle()}
        builder={undefined}
        composerRef={{ current: null }}
        onWorkingChange={() => undefined}
        onAnnounce={() => undefined}
      />,
    );

    say("put it on test");
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: t("agent.card.confirm") })).toBeTruthy();
    });
    revealed.length = 0;

    say("anything else?");
    await vi.waitFor(() => {
      expect(screen.getByText("Nothing needs changing.")).toBeTruthy();
    });

    const last = revealed.at(-1);
    expect(last).toBeDefined();
    expect(last?.textContent).toContain("Nothing needs changing.");
  });
});
