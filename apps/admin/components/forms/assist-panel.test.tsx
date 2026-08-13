// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DraftForm } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

import { AssistPanel } from "./assist-panel";

const DRAFT: DraftForm = {
  formId: "frm_quote",
  defaultLocale: "en",
  title: { en: "Vehicle insurance quote" },
  steps: [
    {
      stepId: "stp_basics",
      title: { en: "Basics" },
      items: [{ questionId: "q_name", version: 1 }],
    },
  ],
  rules: [],
};

/** One SSE frame in the wire shape the assist route relays. */
function frame(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

/** An SSE `ReadableStream<Uint8Array>` body carrying the given frames as one chunk. */
function sseBody(frames: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(frames.join("")));
      controller.close();
    },
  });
}

function sendMessage(text: string): void {
  const input = screen.getByLabelText(t("forms.assist.inputLabel"));
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: t("forms.assist.send") }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AssistPanel", () => {
  it("renders a completed proposal, its diff and its validation issues", async () => {
    const proposal = {
      proposal: {
        proposedDraft: {
          ...DRAFT,
          steps: [
            ...DRAFT.steps,
            { stepId: "stp_history", title: { en: "Driving history" }, items: [] },
          ],
        },
        newQuestions: [],
        rationale: "Added a driving-history step.",
        issues: [{ code: "DANGLING_STEP_REF", message: "That step is not reachable." }],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(sseBody([frame("proposal", proposal)]), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );

    render(
      <AssistPanel
        endpoint="/forms/frm_quote/assist"
        draft={DRAFT}
        draftUpdatedAt={undefined}
        onAccept={vi.fn()}
      />,
    );
    sendMessage("Add a driving history step");

    await waitFor(() => {
      expect(screen.getByTestId("qcms-assist-proposal")).toBeTruthy();
    });
    expect(screen.getByText(/Added:.*Driving history/)).toBeTruthy();
    expect(screen.getByText("That step is not reachable.")).toBeTruthy();
  });

  it("renders the refused/tool-rejected state as an alert", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(sseBody([frame("tool-rejected", { tool: "publish_form" })]), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );

    render(
      <AssistPanel
        endpoint="/forms/frm_quote/assist"
        draft={DRAFT}
        draftUpdatedAt={undefined}
        onAccept={vi.fn()}
      />,
    );
    sendMessage("Publish this form");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("publish_form");
  });

  it("renders the rate-limited state, with the retry-after header when present", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 429, headers: { "retry-after": "30" } })),
    );

    render(
      <AssistPanel
        endpoint="/forms/frm_quote/assist"
        draft={DRAFT}
        draftUpdatedAt={undefined}
        onAccept={vi.fn()}
      />,
    );
    sendMessage("Add a step");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("30");
  });

  it("renders no proposal card, and no error, before anything is sent", () => {
    render(
      <AssistPanel
        endpoint="/forms/frm_quote/assist"
        draft={DRAFT}
        draftUpdatedAt={undefined}
        onAccept={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("qcms-assist-proposal")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(t("forms.assist.emptyHint"))).toBeTruthy();
  });
});
