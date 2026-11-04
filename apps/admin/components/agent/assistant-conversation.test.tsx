import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BuilderAssistSnapshot } from "@/lib/agent/builder-assist-bridge";
import type { ConversationHandle } from "@/lib/agent/conversation";
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
  subject: "Quote",
  turns: [],
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
