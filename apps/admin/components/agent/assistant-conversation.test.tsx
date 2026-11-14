import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BuilderAssistSnapshot } from "@/lib/agent/builder-assist-bridge";
import type { AgentTurnRecord, ConversationHandle } from "@/lib/agent/conversation";
import type { DraftForm } from "@/lib/forms/types";
import type { ResolvedScreen } from "@/lib/agent/screens";
import { t } from "@/lib/i18n/en";

import { AssistantConversation } from "./assistant-conversation";

const SCREEN: ResolvedScreen = {
  screen: "/forms/[formId]",
  params: { formId: "frm_quote" },
};

const CONVERSATION: ConversationHandle = {
  id: "cnv_1",
  visitId: "vis_1",
  subject: "Quote",
  turns: [],
  dropped: 0,
  current: () => [],
  append: () => undefined,
  restart: () => undefined,
};

const DRAFT: DraftForm = {
  formId: "frm_quote",
  defaultLocale: "en",
  title: { en: "Quote" },
  steps: [],
} as unknown as DraftForm;

function snapshot(canPropose: boolean): BuilderAssistSnapshot {
  return {
    endpoint: "/forms/frm_quote/assist",
    canPropose,
    draft: DRAFT,
    draftUpdatedAt: undefined,
    accept: () => undefined,
  };
}

function mount(canPropose: boolean): void {
  render(
    <AssistantConversation
      screen={SCREEN}
      environment="test"
      conversation={CONVERSATION}
      builder={snapshot(canPropose)}
      composerRef={{ current: null }}
      onWorkingChange={() => undefined}
      onAnnounce={() => undefined}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the assistant conversation's route", () => {
  function sent(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>(() =>
      Promise.resolve(new Response(null, { status: 500 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  async function send(fetchMock: ReturnType<typeof vi.fn>): Promise<void> {
    const composer = screen.getByTestId("qcms-assistant-composer");
    fireEvent.change(composer, { target: { value: "what can you see" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  }

  it("draws one conversation whether or not this caller may write the draft", () => {
    mount(false);
    expect(screen.getByTestId("qcms-assistant-composer")).toBeTruthy();
    expect(screen.queryByTestId("qcms-assistant-trimmed")).toBeNull();
  });

  it("says so once the cap has dropped the oldest turns", () => {
    render(
      <AssistantConversation
        screen={SCREEN}
        environment="test"
        conversation={{ ...CONVERSATION, dropped: 3 }}
        builder={snapshot(false)}
        composerRef={{ current: null }}
        onWorkingChange={() => undefined}
        onAnnounce={() => undefined}
      />,
    );
    expect(screen.getByTestId("qcms-assistant-trimmed").textContent).toBe(t("agent.trimmed"));
  });

  it("names the speaker on every turn, and gives the reader's words their own bubble", () => {
    render(
      <AssistantConversation
        screen={SCREEN}
        environment="test"
        conversation={{
          ...CONVERSATION,
          turns: [
            { role: "user", content: "what can you see" },
            { role: "assistant", content: "This screen lists your forms." },
          ],
        }}
        builder={snapshot(false)}
        composerRef={{ current: null }}
        onWorkingChange={() => undefined}
        onAnnounce={() => undefined}
      />,
    );
    const turns = screen.getAllByRole("listitem");
    expect(turns[0]?.querySelector(".qcms-assistant__speaker")?.textContent).toBe(
      t("agent.speaker.you"),
    );
    expect(turns[0]?.querySelector(".qcms-assistant__bubble")).toBeTruthy();
    expect(turns[1]?.querySelector(".qcms-assistant__speaker")?.textContent).toBe(
      t("agent.speaker.assistant"),
    );
    expect(turns[1]?.querySelector(".qcms-assistant__bubble")).toBeNull();
  });

  it("posts a reader's turn to the screen route", async () => {
    const fetchMock = sent();
    mount(false);
    await send(fetchMock);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/assist");
  });

  it("posts a writer's turn to the form's own route, carrying the stored draft", async () => {
    const fetchMock = sent();
    render(
      <AssistantConversation
        screen={SCREEN}
        environment="test"
        conversation={CONVERSATION}
        builder={{ ...snapshot(true), draftUpdatedAt: "2026-11-01T09:00:00.000Z" }}
        composerRef={{ current: null }}
        onWorkingChange={() => undefined}
        onAnnounce={() => undefined}
      />,
    );
    await send(fetchMock);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/forms/frm_quote/assist");
    const init = fetchMock.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(init.body)).toMatchObject({ clientState: "2026-11-01T09:00:00.000Z" });
  });

  it("names a stale draft when the route refuses the turn with a conflict", async () => {
    const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>(() =>
      Promise.resolve(new Response(null, { status: 409 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    mount(true);
    await send(fetchMock);
    await vi.waitFor(() => {
      expect(screen.getByTestId("qcms-assistant-error").textContent).toBe(
        t("forms.assist.error.STALE_DRAFT"),
      );
    });
  });
});

describe("a card's waiting window", () => {
  const ISSUED_AT = "2026-07-20T00:00:00.000Z";

  function proposal(windowMs: number) {
    return {
      proposalId: "prp_window",
      token: "tok",
      steps: [
        {
          kind: "form.publish",
          screen: "/forms/[formId]",
          args: { formId: "frm_quote" },
          environment: "test",
          card: {
            titleKey: "agent.card.form.publish.title",
            consequenceKeys: ["agent.card.form.publish.consequence"],
          },
          resultAllowlist: ["version"],
        },
      ],
      proposedAt: ISSUED_AT,
      expiresAt: new Date(Date.parse(ISSUED_AT) + windowMs).toISOString(),
      formId: "frm_quote",
      currentEnvironment: "test",
    };
  }

  async function proposed(windowMs: number): Promise<void> {
    const event = { type: "action", proposal: proposal(windowMs) };
    const body = `event: action\ndata: ${JSON.stringify(event)}\n\n`;
    const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    mount(true);
    const composer = screen.getByTestId("qcms-assistant-composer");
    fireEvent.change(composer, { target: { value: "publish the draft" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: t("agent.card.confirm") })).toBeTruthy();
    });
  }

  it("arrives Confirmable although the issuing clock is years from this one", async () => {
    await proposed(10 * 60 * 1000);
    expect(
      screen.getByRole("button", { name: t("agent.card.confirm") }).hasAttribute("disabled"),
    ).toBe(false);
    expect(screen.queryByText(t("agent.card.expiredAsk"))).toBeNull();
  });

  it("ticks a waiting card to Expired once its window runs out", async () => {
    await proposed(100);

    await vi.waitFor(() => {
      expect(screen.getByText(t("agent.card.expiredAsk"))).toBeTruthy();
    });
    expect(
      screen.getByRole("button", { name: t("agent.card.confirm") }).hasAttribute("disabled"),
    ).toBe(true);
  });
});

describe("the card a turn is sent with", () => {
  const PROPOSAL = {
    proposalId: "prp_waiting",
    token: "tok",
    steps: [
      {
        kind: "form.publish",
        screen: "/forms/[formId]",
        args: { formId: "frm_quote" },
        environment: "test",
        card: {
          titleKey: "agent.card.form.publish.title",
          consequenceKeys: ["agent.card.form.publish.consequence"],
        },
        resultAllowlist: ["version"],
      },
    ],
    proposedAt: "2026-07-20T00:00:00.000Z",
    expiresAt: "2026-07-20T00:10:00.000Z",
    formId: "frm_quote",
    currentEnvironment: "test",
  };

  async function ask(fetchMock: ReturnType<typeof vi.fn>, text: string): Promise<void> {
    const calls = fetchMock.mock.calls.length;
    const composer = screen.getByTestId("qcms-assistant-composer");
    fireEvent.change(composer, { target: { value: text } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
    });
  }

  function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call: number): { conversation: unknown[] } {
    const init = fetchMock.mock.calls[call]?.[1] as { body: string };
    return JSON.parse(init.body) as { conversation: unknown[] };
  }

  it("names the card still waiting, by its step kinds, on the next turn", async () => {
    const event = { type: "action", proposal: PROPOSAL };
    const body = `event: action\ndata: ${JSON.stringify(event)}\n\n`;
    const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    mount(true);

    await ask(fetchMock, "publish the draft");
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: t("agent.card.confirm") })).toBeTruthy();
    });
    // The turn that produced the card knew of none before it.
    expect(bodyOf(fetchMock, 0).conversation.some((turn) => isProposal(turn))).toBe(false);

    await ask(fetchMock, "go on then");
    expect(bodyOf(fetchMock, 1).conversation.at(-1)).toEqual({
      role: "proposal",
      proposalId: "prp_waiting",
      steps: [{ kind: "form.publish" }],
    });
  });

  it("says nothing about a card the person has already cancelled", async () => {
    const event = { type: "action", proposal: PROPOSAL };
    const body = `event: action\ndata: ${JSON.stringify(event)}\n\n`;
    const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    mount(true);

    await ask(fetchMock, "publish the draft");
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: t("agent.card.confirm") })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: t("agent.card.cancel") }));

    await ask(fetchMock, "what about now");
    expect(bodyOf(fetchMock, 1).conversation.some((turn) => isProposal(turn))).toBe(false);
  });
});

function isProposal(turn: unknown): boolean {
  return (turn as { role?: unknown } | null)?.role === "proposal";
}

describe("a waiting card's screen and environment", () => {
  const PROPOSAL = {
    proposalId: "prp_bound",
    token: "tok",
    steps: [
      {
        kind: "form.publish",
        screen: "/forms/[formId]",
        args: { formId: "frm_quote" },
        environment: "test",
        card: {
          titleKey: "agent.card.form.publish.title",
          consequenceKeys: ["agent.card.form.publish.consequence"],
        },
        resultAllowlist: ["version"],
      },
    ],
    proposedAt: "2026-07-20T00:00:00.000Z",
    expiresAt: "2026-07-20T00:10:00.000Z",
    formId: "frm_quote",
    currentEnvironment: "test",
  };

  function view(on: ResolvedScreen, environment: string) {
    return (
      <AssistantConversation
        screen={on}
        environment={environment}
        conversation={CONVERSATION}
        builder={snapshot(true)}
        composerRef={{ current: null }}
        onWorkingChange={() => undefined}
        onAnnounce={() => undefined}
      />
    );
  }

  async function waiting(): Promise<ReturnType<typeof render>> {
    const event = { type: "action", proposal: PROPOSAL };
    const body = `event: action\ndata: ${JSON.stringify(event)}\n\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn<(input: unknown, init?: unknown) => Promise<Response>>(() =>
        Promise.resolve(
          new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
        ),
      ),
    );
    const mounted = render(view(SCREEN, "test"));
    const composer = screen.getByTestId("qcms-assistant-composer");
    fireEvent.change(composer, { target: { value: "publish the draft" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: t("agent.card.confirm") })).toBeTruthy();
    });
    return mounted;
  }

  async function expectExpired(): Promise<void> {
    await vi.waitFor(() => {
      expect(screen.getByText(t("agent.card.expiredAsk"))).toBeTruthy();
    });
    expect(
      screen.getByRole("button", { name: t("agent.card.confirm") }).hasAttribute("disabled"),
    ).toBe(true);
  }

  it("expires when the operator leaves the screen it was proposed on", async () => {
    const mounted = await waiting();
    mounted.rerender(view({ screen: "/forms", params: {} }, "test"));
    await expectExpired();
  });

  it("expires when the same screen is now about another form", async () => {
    const mounted = await waiting();
    mounted.rerender(view({ screen: "/forms/[formId]", params: { formId: "frm_other" } }, "test"));
    await expectExpired();
  });

  it("expires when the environment switches under it", async () => {
    const mounted = await waiting();
    mounted.rerender(view(SCREEN, "prod"));
    await expectExpired();
  });

  it("stays Confirmable while the screen and the environment hold", async () => {
    const mounted = await waiting();
    mounted.rerender(view(SCREEN, "test"));
    expect(screen.queryByText(t("agent.card.expiredAsk"))).toBeNull();
    expect(
      screen.getByRole("button", { name: t("agent.card.confirm") }).hasAttribute("disabled"),
    ).toBe(false);
  });
});

describe("a waiting card nobody answered", () => {
  const WAITING = {
    proposalId: "prp_first",
    token: "tok",
    steps: [
      {
        kind: "form.publish",
        screen: "/forms/[formId]",
        args: { formId: "frm_quote" },
        environment: "test",
        card: {
          titleKey: "agent.card.form.publish.title",
          consequenceKeys: ["agent.card.form.publish.consequence"],
        },
        resultAllowlist: ["version"],
      },
    ],
    proposedAt: "2026-07-20T00:00:00.000Z",
    expiresAt: "2026-07-20T00:10:00.000Z",
    formId: "frm_quote",
    currentEnvironment: "test",
  };

  function stream(proposalId: string): Response {
    const event = JSON.stringify({
      type: "action",
      proposal: { ...WAITING, proposalId },
    });
    return new Response(`event: action\ndata: ${event}\n\n`, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  let recorded: AgentTurnRecord[] = [];

  function mountRecording(): ReturnType<typeof vi.fn> {
    recorded = [];
    const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AssistantConversation
        screen={SCREEN}
        environment="test"
        conversation={{
          ...CONVERSATION,
          append: (next) => {
            recorded = [...recorded, ...next];
          },
        }}
        builder={snapshot(true)}
        composerRef={{ current: null }}
        onWorkingChange={() => undefined}
        onAnnounce={() => undefined}
      />,
    );
    return fetchMock;
  }

  async function propose(
    fetchMock: ReturnType<typeof vi.fn>,
    proposalId: string,
    text: string,
  ): Promise<void> {
    const calls = fetchMock.mock.calls.length;
    fetchMock.mockResolvedValueOnce(stream(proposalId));
    const composer = screen.getByTestId("qcms-assistant-composer");
    fireEvent.change(composer, { target: { value: text } });
    fireEvent.keyDown(composer, { key: "Enter" });
    // The next turn is only sent once this one has ended, which the restored Send control says.
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
      expect(screen.getByTestId("qcms-assistant-send")).toBeTruthy();
      expect(screen.getAllByRole("button", { name: t("agent.card.confirm") }).length).toBe(1);
    });
  }

  function settlements(): readonly AgentTurnRecord[] {
    return recorded.filter((turn) => turn.role === "action-result");
  }

  it("is cancelled in the record when the person cancels it", async () => {
    const fetchMock = mountRecording();
    await propose(fetchMock, "prp_first", "publish the draft");

    fireEvent.click(screen.getByRole("button", { name: t("agent.card.cancel") }));

    expect(settlements()).toEqual([
      {
        role: "action-result",
        proposalId: "prp_first",
        steps: [{ kind: "form.publish", outcome: "cancelled" }],
      },
    ]);
  });

  it("is cancelled in the same way when the next proposal takes its place", async () => {
    const fetchMock = mountRecording();
    await propose(fetchMock, "prp_first", "publish the draft");
    await propose(fetchMock, "prp_second", "no, publish it this way");

    expect(settlements()).toEqual([
      {
        role: "action-result",
        proposalId: "prp_first",
        steps: [{ kind: "form.publish", outcome: "cancelled" }],
      },
    ]);
  });

  it("leaves the card that ran alone when the next proposal arrives", async () => {
    const fetchMock = mountRecording();
    await propose(fetchMock, "prp_first", "publish the draft");
    fireEvent.click(screen.getByRole("button", { name: t("agent.card.cancel") }));
    await propose(fetchMock, "prp_second", "try again");

    expect(settlements()).toHaveLength(1);
  });
});
