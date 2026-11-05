import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BuilderAssistSnapshot } from "@/lib/agent/builder-assist-bridge";
import type { ConversationHandle } from "@/lib/agent/conversation";
import type { DraftForm } from "@/lib/forms/types";
import type { ResolvedScreen } from "@/lib/agent/screens";
import { t } from "@/lib/i18n/en";

import { AssistantConversation } from "./assistant-conversation";

const SCREEN: ResolvedScreen = { screen: "/forms", params: {} };

const CONVERSATION: ConversationHandle = {
  id: "cnv_focus",
  visitId: "vis_focus",
  subject: "Forms",
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

const PROPOSAL = {
  proposalId: "prp_focus",
  token: "tok",
  steps: [
    {
      kind: "form.publish",
      screen: "/forms",
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

const BUILDER: BuilderAssistSnapshot = {
  endpoint: "/forms/frm_quote/assist",
  canPropose: true,
  draft: DRAFT,
  draftUpdatedAt: undefined,
  accept: () => undefined,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

async function withCard(): Promise<HTMLTextAreaElement> {
  const body = `event: action\ndata: ${JSON.stringify({ type: "action", proposal: PROPOSAL })}\n\n`;
  vi.stubGlobal(
    "fetch",
    vi.fn<(input: unknown, init?: unknown) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
      ),
    ),
  );
  render(
    <AssistantConversation
      screen={SCREEN}
      environment="test"
      conversation={CONVERSATION}
      builder={BUILDER}
      composerRef={{ current: null }}
      onWorkingChange={() => undefined}
      onAnnounce={() => undefined}
    />,
  );
  const composer = screen.getByTestId<HTMLTextAreaElement>("qcms-assistant-composer");
  fireEvent.change(composer, { target: { value: "publish the draft" } });
  fireEvent.keyDown(composer, { key: "Enter" });
  await vi.waitFor(() => {
    expect(screen.getByRole("button", { name: t("agent.card.confirm") })).toBeTruthy();
  });
  return composer;
}

function typeInto(composer: HTMLTextAreaElement, text: string): void {
  composer.focus();
  let sofar = "";
  for (const character of text) {
    sofar += character;
    fireEvent.change(composer, { target: { value: sofar } });
  }
}

describe("the composer while an action card is on screen", () => {
  it("keeps the caret in the composer under a waiting card", async () => {
    const composer = await withCard();
    typeInto(composer, "and then");
    expect(document.activeElement).toBe(composer);
    expect(composer.value).toBe("and then");
  });

  it("keeps the caret in the composer under a settled card", async () => {
    const composer = await withCard();
    fireEvent.click(screen.getByRole("button", { name: t("agent.card.cancel") }));
    typeInto(composer, "and then");
    expect(document.activeElement).toBe(composer);
    expect(composer.value).toBe("and then");
  });
});
