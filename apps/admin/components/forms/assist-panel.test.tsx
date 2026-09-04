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
        warnings: [],
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
    // No warnings on this proposal, so no warning block at all rather than an
    // empty one asserting there is nothing worth a look.
    expect(screen.queryByTestId("qcms-assist-warnings")).toBeNull();
  });

  /**
   * The proposal card shows the same two lists the builder's validation panel
   * shows for the same draft (issue #123, ADR-25's "the kernel validates").
   *
   * The interesting shape is exactly this one: no issues, one warning. Before the
   * warnings channel reached this panel it read "Validation passes" and stopped,
   * over a draft the validation panel flags the moment Accept stores it - the
   * screen contradicting itself about one draft one debounce apart.
   */
  it("shows a warning beside a clean issue list rather than claiming all is well", async () => {
    const proposal = {
      proposal: {
        proposedDraft: DRAFT,
        newQuestions: [],
        rationale: "Reused the existing step.",
        issues: [],
        warnings: [
          {
            code: "MULTICHOICE_SAME_STEP_TARGET",
            message: "This rule reveals a question on the step it reads from.",
          },
        ],
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
    sendMessage("Reuse the step I have");

    await waitFor(() => {
      expect(screen.getByTestId("qcms-assist-warnings")).toBeTruthy();
    });
    // The publishability line still says the draft would publish, because a
    // warning does not block one. Both statements stand, which is the point.
    expect(screen.getByText(t("forms.assist.validationClean"))).toBeTruthy();
    expect(screen.getByText(t("forms.warning.heading"))).toBeTruthy();
    expect(screen.getByText(t("forms.warning.countOne"))).toBeTruthy();
    expect(
      screen.getByText("This rule reveals a question on the step it reads from."),
    ).toBeTruthy();
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

  /**
   * The rejection handler `components/rejection-coverage.test.ts` declares for this file
   * (issue #352), driven rather than declared.
   *
   * `errorForResponse` reads the failure body with `response.json().catch(() => undefined)`.
   * The `.catch` is the whole point: a failing response does not have to carry JSON. An
   * ingress returning its own HTML error page, or a truncated body, is the ordinary shape
   * of the failures this panel exists to survive, and without the handler the parse
   * rejection would escape the send path and leave the operator watching a spinner that
   * never resolves. With it, the status number is what they are told instead.
   *
   * Verified red: dropping the `.catch` fails this test with an unhandled `SyntaxError`
   * rather than a rendered alert.
   */
  it("reports the status when a failing response carries no JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><body>502 Bad Gateway</body></html>", {
          status: 502,
          headers: { "content-type": "text/html" },
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
    sendMessage("Add a step");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("502");
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
