import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentTurnRecord, ConversationHandle } from "@/lib/agent/conversation";
import type { AgentPlanStep, AgentProposal } from "@/lib/forms/assist-stream";
import type { ResolvedScreen } from "@/lib/agent/screens";
import { t } from "@/lib/i18n/en";

type ActionDouble = (...args: readonly unknown[]) => Promise<unknown>;

const reviewReleaseAction = vi.fn<ActionDouble>();
const confirmPublishAction = vi.fn<ActionDouble>();

vi.mock("@/app/(shell)/forms/actions", () => ({
  confirmPublishAction: (...args: readonly unknown[]): Promise<unknown> =>
    confirmPublishAction(...args),
  reviewReleaseAction: (...args: readonly unknown[]): Promise<unknown> =>
    reviewReleaseAction(...args),
  createFormForCardAction: vi.fn(),
  mintLinksAction: vi.fn(),
  revokeLinkAction: vi.fn(),
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

const SCREEN: ResolvedScreen = { screen: "/forms", params: {} };

const PUBLISH: AgentPlanStep = {
  kind: "form.publish",
  screen: "/forms/[formId]",
  args: { formId: "frm_quote" },
  environment: "test",
  handOff: false,
  local: false,
  card: { titleKey: "agent.card.form.publish.title", consequenceKeys: [] },
  resultAllowlist: ["version", "environment"],
};

function proposal(thenAnother: boolean): AgentProposal {
  return {
    proposalId: "prp_publish",
    token: "tok",
    steps: [PUBLISH],
    proposedAt: "2026-11-02T10:00:00.000Z",
    expiresAt: "2026-11-02T10:10:00.000Z",
    formId: "frm_quote",
    currentEnvironment: "test",
    ...(thenAnother ? { thenAnother: true } : {}),
  };
}

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
    carryTo: () => undefined,
  };
}

function stream(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function confirmThePublish(
  thenAnother: boolean,
): Promise<ReturnType<typeof vi.fn<(input: unknown, init?: unknown) => Promise<Response>>>> {
  const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>();
  const event = { type: "plan", proposal: proposal(thenAnother) };
  fetchMock.mockResolvedValueOnce(stream(`event: plan\ndata: ${JSON.stringify(event)}\n\n`));
  fetchMock.mockResolvedValue(stream(""));
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
  const composer = screen.getByTestId("qcms-assistant-composer");
  fireEvent.change(composer, { target: { value: "put it on test" } });
  fireEvent.keyDown(composer, { key: "Enter" });
  await vi.waitFor(() => {
    expect(screen.getByRole("button", { name: t("agent.card.confirm") })).toBeTruthy();
  });
  fireEvent.click(screen.getByRole("button", { name: t("agent.card.confirm") }));
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  reviewReleaseAction.mockResolvedValue({
    ok: true,
    data: {
      source: { kind: "draft", draftRevision: 4 },
      workflowRevision: 2,
      workflowSource: "configured",
      targets: [
        {
          environment: "test",
          currentVersion: null,
          currentSequence: 9,
          closed: false,
          evidence: [],
          blockers: [],
          twoPerson: { applies: false, refusedAsAuthor: false, heldForApproval: false },
          protected: false,
        },
      ],
    },
  });
  confirmPublishAction.mockResolvedValue({ status: "done", version: 1, froze: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a card the assistant said another has to follow", () => {
  it("takes its own turn once every step has run, with no message of the person's", async () => {
    const fetchMock = await confirmThePublish(true);
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.length).toBe(2);
    });
    const init = fetchMock.mock.calls[1]?.[1] as { body: string };
    const body = JSON.parse(init.body) as {
      conversation: readonly { role: string; proposalId?: string }[];
    };
    const last = body.conversation.at(-1);
    expect(last?.role).toBe("action-result");
    expect(last?.proposalId).toBe("prp_publish");
    expect(body.conversation.filter((turn) => turn.role === "user")).toHaveLength(1);
  });

  it("waits to be asked where the plan promised nothing", async () => {
    const fetchMock = await confirmThePublish(false);
    await vi.waitFor(() => {
      expect(screen.getAllByText(t("agent.card.result.done.one", { count: 1 }))).not.toHaveLength(
        0,
      );
    });
    // A turn would be posted a tick after the card settles, so give it that tick to appear.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
