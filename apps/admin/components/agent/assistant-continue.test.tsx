import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentTurnRecord, ConversationHandle } from "@/lib/agent/conversation";
import type { DraftForm } from "@/lib/forms/types";
import type { ResolvedScreen } from "@/lib/agent/screens";
import { t } from "@/lib/i18n/en";

/**
 * The turn the panel posts itself once an accept has settled.
 *
 * It is the only turn nobody typed, and it is what makes the publish card the second half
 * of one journey rather than something the person has to ask for twice. What this pins is
 * the shape of that request: the conversation ending in the card's own `action-result`
 * record, no user message appended to it, and the draft token the accept's save produced
 * rather than the one the render before it held.
 */

const DRAFT: DraftForm = {
  formId: "frm_quote",
  defaultLocale: "en",
  title: { en: "Quote" },
  steps: [
    {
      stepId: "stp_basics",
      title: { en: "Basics" },
      items: [{ questionId: "q_name", version: 1 }],
    },
  ],
  rules: [],
} as unknown as DraftForm;

const accept = vi.fn<(...args: readonly unknown[]) => Promise<unknown>>();

vi.mock("@/lib/agent/builder-assist-bridge", () => ({
  builderAssistSnapshot: () => ({
    endpoint: "/forms/frm_quote/assist",
    canPropose: true,
    draft: DRAFT,
    draftUpdatedAt: "2026-11-02T10:00:01.000Z",
    accept: (...args: readonly unknown[]): Promise<unknown> => accept(...args),
  }),
  useBuilderAssist: () => undefined,
  usePublishBuilderAssist: () => undefined,
  recordDraftSaved: () => undefined,
}));

const { AssistantConversation } = await import("./assistant-conversation");

const SCREEN: ResolvedScreen = {
  screen: "/forms/[formId]",
  params: { formId: "frm_quote" },
};

const APPLY_DRAFT_PROPOSAL = {
  proposalId: "prp_apply",
  token: undefined,
  steps: [
    {
      kind: "apply-draft",
      screen: "/forms/[formId]",
      args: { formId: "frm_quote" },
      environment: "test",
      local: true,
      handOff: false,
      draft: {
        definition: { ...DRAFT, title: { en: "Patient registration" } },
        newQuestions: [{ questionId: "q_given_name", type: "shortText", label: { en: "Given" } }],
        issues: [],
        warnings: [],
      },
      card: { titleKey: "agent.card.apply-draft.title", consequenceKeys: [] },
      resultAllowlist: ["changes", "newQuestions"],
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
    subject: "Quote",
    turns,
    current: () => turns,
    append: (next) => {
      turns = [...turns, ...next];
    },
    restart: () => undefined,
  };
}

function stream(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function actionStream(): Response {
  const event = { type: "action", proposal: APPLY_DRAFT_PROPOSAL };
  return stream(`event: action\ndata: ${JSON.stringify(event)}\n\n`);
}

beforeEach(() => {
  vi.clearAllMocks();
  accept.mockResolvedValue({ ok: true, changes: 4, newQuestions: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the turn the panel posts after an accept settles", () => {
  async function confirmAccept(): Promise<ReturnType<typeof vi.fn>> {
    const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>();
    fetchMock.mockResolvedValueOnce(actionStream());
    fetchMock.mockResolvedValue(stream(""));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AssistantConversation
        screen={SCREEN}
        conversation={conversationHandle()}
        builder={{
          endpoint: "/forms/frm_quote/assist",
          canPropose: true,
          draft: DRAFT,
          draftUpdatedAt: "2026-11-02T09:00:00.000Z",
          accept: (...args: readonly unknown[]) =>
            accept(...args) as Promise<
              { ok: true; changes: number; newQuestions: number } | { ok: false; message: string }
            >,
        }}
        composerRef={{ current: null }}
        onWorkingChange={() => undefined}
        onAnnounce={() => undefined}
      />,
    );
    const composer = screen.getByTestId("qcms-assistant-composer");
    fireEvent.change(composer, { target: { value: "build me a form" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: t("agent.card.confirm") })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: t("agent.card.confirm") }));
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    });
    return fetchMock;
  }

  it("sends the conversation ending in the card's own record, with no message of the person's", async () => {
    const fetchMock = await confirmAccept();
    const init = fetchMock.mock.calls[1]?.[1] as { body: string };
    const body = JSON.parse(init.body) as {
      conversation: readonly { role: string; proposalId?: string }[];
    };
    const last = body.conversation.at(-1);
    expect(last?.role).toBe("action-result");
    expect(last?.proposalId).toBe("prp_apply");
    expect(body.conversation.filter((turn) => turn.role === "user")).toHaveLength(1);
  });

  it("carries the draft token the accept's own save produced", async () => {
    const fetchMock = await confirmAccept();
    const init = fetchMock.mock.calls[1]?.[1] as { body: string };
    expect(JSON.parse(init.body)).toMatchObject({ clientState: "2026-11-02T10:00:01.000Z" });
  });

  it("posts nothing of its own when the accept was refused", async () => {
    accept.mockResolvedValue({ ok: false, message: "That question id is already in use." });
    const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>();
    fetchMock.mockResolvedValueOnce(actionStream());
    fetchMock.mockResolvedValue(stream(""));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AssistantConversation
        screen={SCREEN}
        conversation={conversationHandle()}
        builder={{
          endpoint: "/forms/frm_quote/assist",
          canPropose: true,
          draft: DRAFT,
          draftUpdatedAt: undefined,
          accept: (...args: readonly unknown[]) =>
            accept(...args) as Promise<
              { ok: true; changes: number; newQuestions: number } | { ok: false; message: string }
            >,
        }}
        composerRef={{ current: null }}
        onWorkingChange={() => undefined}
        onAnnounce={() => undefined}
      />,
    );
    const composer = screen.getByTestId("qcms-assistant-composer");
    fireEvent.change(composer, { target: { value: "build me a form" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: t("agent.card.confirm") })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: t("agent.card.confirm") }));
    await vi.waitFor(() => {
      expect(screen.getByText("That question id is already in use.")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
