import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentTurnRecord, ConversationHandle } from "@/lib/agent/conversation";
import type { ResolvedScreen } from "@/lib/agent/screens";
import { serializeConversation } from "@/lib/agent/conversation-state";
import type { MintedLink } from "@/lib/forms/types";
import { t, tPlural } from "@/lib/i18n/en";

type ActionDouble = (...args: readonly unknown[]) => Promise<unknown>;

const mintLinksAction = vi.fn<ActionDouble>();
const revokeLinkAction = vi.fn<ActionDouble>();

vi.mock("@/app/(shell)/forms/actions", () => ({
  confirmPublishAction: vi.fn(),
  createFormForCardAction: vi.fn(),
  mintLinksAction: (...args: readonly unknown[]): Promise<unknown> => mintLinksAction(...args),
  releaseVersionAction: vi.fn(),
  reviewReleaseAction: vi.fn(),
  revokeLinkAction: (...args: readonly unknown[]): Promise<unknown> => revokeLinkAction(...args),
  setFormStatusAction: vi.fn(),
  updateSettingsAction: vi.fn(),
}));

vi.mock("@/lib/agent/builder-assist-bridge", () => ({
  builderAssistSnapshot: () => undefined,
  nextDraftSaved: (): Promise<string | undefined> => Promise.resolve(undefined),
  recordDraftSaved: () => undefined,
  useBuilderAssist: () => undefined,
  usePublishBuilderAssist: () => undefined,
}));

const { AssistantConversation } = await import("./assistant-conversation");

const SCREEN: ResolvedScreen = {
  screen: "/operations/forms/[formId]/links",
  params: { formId: "frm_quote" },
};

const LINKS: readonly MintedLink[] = [
  {
    linkId: "lnk_one",
    environment: "test",
    url: "https://forms.example/test/l/token-one",
    expiresAt: "2026-11-30T23:59:59.000Z",
  },
  {
    linkId: "lnk_two",
    environment: "test",
    url: "https://forms.example/test/l/token-two",
    expiresAt: "2026-11-30T23:59:59.000Z",
  },
];

function proposal(proposalId: string, step: Record<string, unknown>): Record<string, unknown> {
  return {
    proposalId,
    token: "tok",
    steps: [step],
    proposedAt: "2026-11-02T10:00:00.000Z",
    expiresAt: "2026-11-02T10:10:00.000Z",
    formId: "frm_quote",
    currentEnvironment: "test",
  };
}

const MINT = proposal("prp_mint", {
  kind: "link.mint",
  screen: "/operations/forms/[formId]/links",
  args: { formId: "frm_quote", count: 2, expiresAt: "2026-11-30T23:59:59.000Z", oneTime: true },
  environment: "test",
  local: false,
  handOff: false,
  card: { titleKey: "agent.card.link.mint.title", consequenceKeys: [] },
  resultAllowlist: ["count", "expiresAt", "environment"],
});

const REVOKE = proposal("prp_revoke", {
  kind: "link.revoke",
  screen: "/operations/forms/[formId]/links",
  args: { formId: "frm_quote", linkId: "lnk_one" },
  environment: "test",
  local: false,
  handOff: false,
  card: { titleKey: "agent.card.link.revoke.title", consequenceKeys: [] },
  resultAllowlist: ["linkId", "environment"],
});

function actionStream(plan: Record<string, unknown>): Response {
  const event = JSON.stringify({ type: "action", proposal: plan });
  return new Response(`event: action\ndata: ${event}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

let turns: readonly AgentTurnRecord[] = [];

function conversationHandle(): ConversationHandle {
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

function mount(): void {
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
}

async function say(message: string): Promise<void> {
  const composer = screen.getByTestId("qcms-assistant-composer");
  fireEvent.change(composer, { target: { value: message } });
  fireEvent.keyDown(composer, { key: "Enter" });
  await vi.waitFor(() => {
    expect(screen.getAllByRole("button", { name: t("agent.card.confirm") }).length).toBeGreaterThan(
      0,
    );
  });
}

async function mintThroughTheCard(fetchMock: ReturnType<typeof vi.fn>): Promise<void> {
  fetchMock.mockResolvedValueOnce(actionStream(MINT));
  mount();
  await say("mint two links");
  fireEvent.click(screen.getByRole("button", { name: t("agent.card.confirm") }));
  await vi.waitFor(() => {
    expect(screen.getByTestId("qcms-acard-reveal-list")).toBeTruthy();
  });
}

function addressesShown(): readonly string[] {
  return [...document.querySelectorAll(".qcms-acard__reveal-list code")].map(
    (code) => code.textContent ?? "",
  );
}

function fetchStub(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  mintLinksAction.mockResolvedValue({ status: "minted", links: LINKS });
  revokeLinkAction.mockResolvedValue({ status: "revoked", linkId: "lnk_one" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the addresses a confirmed mint put on the card", () => {
  it("are listed once the step is done", async () => {
    await mintThroughTheCard(fetchStub());

    expect(addressesShown()).toEqual(LINKS.map((link) => link.url));
    expect(
      screen.getByText(tPlural("agent.card.reveal.links.one", "agent.card.reveal.links.other", 2)),
    ).toBeTruthy();
  });

  it("stay on their own card when the assistant proposes the next one", async () => {
    const fetchMock = fetchStub();
    await mintThroughTheCard(fetchMock);

    fetchMock.mockResolvedValueOnce(actionStream(REVOKE));
    await say("now revoke the first one");

    expect(addressesShown()).toEqual(LINKS.map((link) => link.url));
    expect(document.querySelectorAll(".qcms-acard[data-held]")).toHaveLength(1);
    expect(document.querySelectorAll(".qcms-acard")).toHaveLength(2);
  });

  it("go when the person hides them, and the card they were holding goes with them", async () => {
    const fetchMock = fetchStub();
    await mintThroughTheCard(fetchMock);
    fetchMock.mockResolvedValueOnce(actionStream(REVOKE));
    await say("now revoke the first one");

    fireEvent.click(screen.getByRole("button", { name: t("agent.card.reveal.dismiss") }));

    expect(screen.queryByTestId("qcms-acard-reveal-list")).toBeNull();
    expect(document.querySelectorAll(".qcms-acard[data-held]")).toHaveLength(0);
    expect(document.querySelectorAll(".qcms-acard")).toHaveLength(1);
  });

  it("are gone from a conversation drawn again, because nothing stored them", async () => {
    await mintThroughTheCard(fetchStub());
    const kept = turns;

    cleanup();
    render(
      <AssistantConversation
        screen={SCREEN}
        environment="test"
        conversation={{ ...conversationHandle(), turns: kept, current: () => kept }}
        builder={undefined}
        composerRef={{ current: null }}
        onWorkingChange={() => undefined}
        onAnnounce={() => undefined}
      />,
    );

    expect(screen.queryByTestId("qcms-acard-reveal-list")).toBeNull();
    for (const link of LINKS) {
      expect(document.body.textContent ?? "").not.toContain(link.url);
    }
  });
});

describe("what the next turn carries back to the model", () => {
  it("holds the mint's allowlisted count and no address at all", async () => {
    const fetchMock = fetchStub();
    await mintThroughTheCard(fetchMock);

    fetchMock.mockResolvedValueOnce(actionStream(REVOKE));
    await say("now revoke the first one");

    const init = fetchMock.mock.calls[1]?.[1] as { body: string };
    const body = JSON.parse(init.body) as {
      conversation: readonly { role: string; steps?: readonly { result?: unknown }[] }[];
    };
    const result = body.conversation.find((turn) => turn.role === "action-result");
    expect(result?.steps?.[0]?.result).toEqual({
      count: 2,
      expiresAt: "2026-11-30T23:59:59.000Z",
      environment: "test",
    });
    for (const link of LINKS) {
      expect(init.body).not.toContain(link.url);
      expect(init.body).not.toContain(link.linkId);
    }
  });

  it("serializes for tab storage with no address in it", async () => {
    await mintThroughTheCard(fetchStub());

    const stored = serializeConversation(
      { id: "cnv_1", visitId: "vis_1", subject: "Quote", turns, dropped: 0 },
      "someone@qcms.test",
    );
    for (const link of LINKS) {
      expect(stored).not.toContain(link.url);
    }
    expect(window.sessionStorage.length).toBe(0);
  });
});
