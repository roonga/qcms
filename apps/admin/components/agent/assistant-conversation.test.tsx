import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BuilderAssistSnapshot } from "@/lib/agent/builder-assist-bridge";
import type { ConversationHandle } from "@/lib/agent/conversation";
import type { DraftForm } from "@/lib/forms/types";
import type { ResolvedScreen } from "@/lib/agent/screens";

import { AssistantConversation } from "./assistant-conversation";

const SCREEN: ResolvedScreen = {
  screen: "/forms/[formId]",
  params: { formId: "frm_quote" },
};

const CONVERSATION: ConversationHandle = {
  id: "cnv_1",
  subject: "Quote",
  turns: [],
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

/**
 * The builder's own route requires `form: write`, so a caller holding only `form: read`
 * has to take the screen route to get a turn at all. The capability arrives with the
 * published snapshot; nothing here reads the network to find it out.
 */
describe("the hosted panel for a caller who may not write the draft", () => {
  it("draws the screen conversation rather than the proposal panel", () => {
    mount(false);
    expect(screen.getByTestId("qcms-assistant-composer")).toBeTruthy();
    expect(screen.queryByTestId("qcms-assist-panel")).toBeNull();
  });

  it("posts the turn to the screen route", async () => {
    const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>(() =>
      Promise.resolve(new Response(null, { status: 500 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    mount(false);
    const composer = screen.getByTestId("qcms-assistant-composer");
    fireEvent.change(composer, { target: { value: "what can you see" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/assist");
  });

  it("draws the proposal panel for a caller who may write", () => {
    mount(true);
    expect(screen.getByTestId("qcms-assist-panel")).toBeTruthy();
  });
});
