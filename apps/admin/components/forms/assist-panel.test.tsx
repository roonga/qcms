import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DraftForm } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

import { AssistPanel, messageForError } from "./assist-panel";

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

  it("explains a pin on a question the proposal invents instead of saying to pin it", async () => {
    // Before Accept a proposed question is not stored, so the kernel reports its pin as
    // DANGLING_QUESTION_REF. The builder's sentence for that code ("Pin it") is wrong here:
    // Accept creates the question as a draft, and publishing it is the next step (#1065).
    const proposal = {
      proposal: {
        proposedDraft: {
          ...DRAFT,
          steps: [
            ...DRAFT.steps,
            {
              stepId: "stp_vehicle",
              title: { en: "Your vehicle" },
              items: [{ questionId: "q_vehicle_make", version: 1 }],
            },
          ],
        },
        newQuestions: [
          { questionId: "q_vehicle_make", type: "shortText" },
          // Invented AND read by a rule, but pinned by no step: accepting creates it in the
          // library and the form still does not pin it, so the reference stays dangling.
          { questionId: "q_vehicle_colour", type: "shortText" },
        ],
        rationale: "Added a vehicle step.",
        issues: [
          {
            code: "DANGLING_QUESTION_REF",
            message: 'Step "stp_vehicle" pins question "q_vehicle_make"@1, which does not resolve',
            path: { step: "stp_vehicle", question: "q_vehicle_make" },
          },
          {
            code: "DANGLING_QUESTION_REF",
            message: 'Rule "rul_x" reads question "q_gone", which no step pins',
            path: { rule: "rul_x", question: "q_gone" },
          },
          {
            code: "DANGLING_QUESTION_REF",
            message: 'Rule "rul_y" reads question "q_vehicle_colour", which no step pins',
            path: { rule: "rul_y", question: "q_vehicle_colour" },
          },
        ],
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
    sendMessage("Add a vehicle step");

    await waitFor(() => {
      expect(screen.getByTestId("qcms-assist-proposal")).toBeTruthy();
    });
    const validation = screen.getByTestId("qcms-assist-validation");
    expect(validation.textContent).toContain(
      t("forms.assist.newQuestionPending", { questionId: "q_vehicle_make" }),
    );
    // Genuinely dangling references still read as the builder reads them - including one to
    // a question this proposal invents, when no step pins it.
    expect(validation.textContent).not.toContain(
      t("forms.assist.newQuestionPending", { questionId: "q_vehicle_colour" }),
    );
    expect(validation.querySelectorAll('[data-issue-code="DANGLING_QUESTION_REF"]')).toHaveLength(
      3,
    );
    expect(validation.querySelectorAll("[data-new-question]")).toHaveLength(1);
    expect(validation.textContent?.split(t("forms.issue.danglingQuestion")).length).toBe(3);
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

  it("streams prose into an assistant bubble, with a step timeline in plain language", async () => {
    const encoder = new TextEncoder();
    let push: ((chunk: string) => void) | undefined;
    let end: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (chunk) => {
          controller.enqueue(encoder.encode(chunk));
        };
        end = () => {
          controller.close();
        };
      },
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
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

    push?.(frame("status", { phase: "thinking" }));
    push?.(frame("text", { delta: "I will search the library for `q_name` " }));
    push?.(frame("status", { phase: "tool", tool: "search_question_library", step: 1 }));

    // Mid-turn: the bubble is live and the prose so far is rendered as Markdown. The
    // timeline is the last segment, so the caret is not after the prose yet.
    const live = await screen.findByTestId("qcms-assist-live");
    expect(live.getAttribute("aria-busy")).toBe("true");
    expect(live.querySelector("code")?.textContent).toBe("q_name");
    expect(live.textContent).not.toContain("`");
    const steps = screen.getByRole("list", { name: t("forms.assist.stepsLabel") });
    expect(steps.textContent).toContain(t("forms.assist.step.search_question_library"));
    expect(steps.textContent).not.toContain("search_question_library");
    expect(steps.querySelector("li")?.getAttribute("data-state")).toBe("running");
    expect(screen.getByTestId("qcms-assist-status").textContent).toBe(
      t("forms.assist.step.search_question_library"),
    );

    // A later status alone is not evidence the search worked; its outcome is.
    push?.(frame("status", { phase: "thinking" }));
    push?.(frame("text", { delta: "Found **one**." }));
    await waitFor(() => {
      expect(screen.getByTestId("qcms-assist-live").textContent).toContain("Found");
    });
    expect(steps.querySelector("li")?.getAttribute("data-state")).toBe("running");
    push?.(frame("tool-outcome", { step: 1, outcome: "done" }));
    await waitFor(() => {
      expect(steps.querySelector("li")?.getAttribute("data-state")).toBe("done");
    });
    expect(
      screen.getByTestId("qcms-assist-live").querySelector(".qcms-assist-caret"),
    ).not.toBeNull();

    end?.();
    await waitFor(() => {
      expect(screen.queryByTestId("qcms-assist-live")).toBeNull();
    });
    const conversation = screen.getByTestId("qcms-assist-conversation");
    const bubbles = conversation.querySelectorAll(":scope > li");
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]?.getAttribute("data-role")).toBe("user");
    expect(bubbles[1]?.getAttribute("data-role")).toBe("assistant");
    expect(bubbles[1]?.querySelector("strong")?.textContent).toBe("one");
    expect(conversation.querySelector(".qcms-assist-caret")).toBeNull();
  });

  it("shows the rationale once, in the conversation, and the card refers to it", async () => {
    const rationale = "Added a driving-history step.";
    const proposal = {
      proposal: { proposedDraft: DRAFT, newQuestions: [], rationale, issues: [], warnings: [] },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(sseBody([frame("text", { delta: rationale }), frame("proposal", proposal)]), {
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
    sendMessage("Add a step");

    const card = await screen.findByTestId("qcms-assist-proposal");
    await waitFor(() => {
      expect(screen.getByTestId("qcms-assist-conversation").textContent).toContain(rationale);
    });
    expect(card.textContent).not.toContain(rationale);
    expect(card.textContent).toContain(t("forms.assist.rationaleAbove"));
    expect(screen.getAllByText(rationale)).toHaveLength(1);
    // Accept and Discard sit together in the card's footer, after the diff and validation.
    const footer = card.querySelector(".qcms-assist-card__actions");
    expect(footer?.querySelector("[data-testid='qcms-assist-accept']")).not.toBeNull();
    expect(footer?.querySelector("[data-testid='qcms-assist-discard']")).not.toBeNull();
  });

  it("puts a rationale that never streamed into the conversation rather than the card", async () => {
    const proposal = {
      proposal: {
        proposedDraft: DRAFT,
        newQuestions: [],
        rationale: "Kept it as is.",
        issues: [],
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
    sendMessage("Anything to change?");

    const card = await screen.findByTestId("qcms-assist-proposal");
    await waitFor(() => {
      expect(screen.getByTestId("qcms-assist-conversation").textContent).toContain(
        "Kept it as is.",
      );
    });
    expect(card.textContent).not.toContain("Kept it as is.");
  });

  it("sends the prose of earlier turns as history, not the timeline", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(
            sseBody([
              frame("status", { phase: "tool", tool: "search_question_library" }),
              frame("text", { delta: "Nothing found." }),
            ]),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AssistPanel
        endpoint="/forms/frm_quote/assist"
        draft={DRAFT}
        draftUpdatedAt={undefined}
        onAccept={vi.fn()}
      />,
    );
    sendMessage("First");
    await waitFor(() => {
      expect(screen.queryByTestId("qcms-assist-live")).toBeNull();
      expect(screen.getByTestId("qcms-assist-conversation").textContent).toContain(
        "Nothing found.",
      );
    });
    sendMessage("Second");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as { conversation: unknown };
    expect(sent.conversation).toEqual([
      { role: "user", content: "First" },
      { role: "assistant", content: "Nothing found." },
      { role: "user", content: "Second" },
    ]);
  });

  describe("the step timeline is honest about how each step ended", () => {
    function renderPanel(): void {
      render(
        <AssistPanel
          endpoint="/forms/frm_quote/assist"
          draft={DRAFT}
          draftUpdatedAt={undefined}
          onAccept={vi.fn()}
        />,
      );
    }

    async function stepStates(): Promise<(string | null)[]> {
      await waitFor(() => {
        expect(screen.queryByTestId("qcms-assist-live")).toBeNull();
      });
      const steps = screen.getByRole("list", { name: t("forms.assist.stepsLabel") });
      return [...steps.querySelectorAll("li")].map((li) => li.getAttribute("data-state"));
    }

    function streamResponse(frames: readonly string[]): Response {
      return new Response(sseBody(frames), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }

    it("shows a failed call as failed and its retry as done", async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            streamResponse([
              frame("status", { phase: "tool", tool: "propose_draft", step: 1 }),
              frame("tool-outcome", { step: 1, outcome: "failed" }),
              frame("status", { phase: "thinking" }),
              frame("status", { phase: "tool", tool: "propose_draft", step: 2 }),
              frame("tool-outcome", { step: 2, outcome: "done" }),
            ]),
          ),
      );
      renderPanel();
      sendMessage("Add a step");
      expect(await stepStates()).toEqual(["failed", "done"]);
      const steps = screen.getByRole("list", { name: t("forms.assist.stepsLabel") });
      expect(steps.textContent).toContain(t("forms.assist.stepFailed"));
    });

    it("never shows Done for a step a terminal error cut off", async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            streamResponse([
              frame("status", { phase: "tool", tool: "validate_draft", step: 1 }),
              frame("error", { code: "PROVIDER_ERROR", message: "upstream" }),
            ]),
          ),
      );
      renderPanel();
      sendMessage("Check it");
      expect(await stepStates()).toEqual(["interrupted"]);
      const steps = screen.getByRole("list", { name: t("forms.assist.stepsLabel") });
      expect(steps.textContent).toContain(t("forms.assist.stepInterrupted"));
      expect(steps.querySelector("[data-state='done']")).toBeNull();
      expect(screen.getByRole("alert").textContent).not.toContain("upstream");
    });

    it("never shows Done when reading the stream fails mid-step", async () => {
      const encoder = new TextEncoder();
      // The first read delivers the step; the next one fails, as a dropped connection does.
      let delivered = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (delivered) {
            controller.error(new Error("connection reset"));
            return;
          }
          delivered = true;
          controller.enqueue(
            encoder.encode(frame("status", { phase: "tool", tool: "propose_draft", step: 1 })),
          );
        },
      });
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
          ),
      );
      renderPanel();
      sendMessage("Draft it");
      expect(await stepStates()).toEqual(["interrupted"]);
      expect(screen.getByRole("alert").textContent).toBe(
        messageForError({ kind: "PROVIDER_ERROR" }),
      );
    });
  });

  describe("the header", () => {
    it("has named icon buttons, and no full-width collapse button", () => {
      render(
        <AssistPanel
          endpoint="/forms/frm_quote/assist"
          draft={DRAFT}
          draftUpdatedAt={undefined}
          onAccept={vi.fn()}
        />,
      );
      const toggle = screen.getByRole("button", { name: t("forms.assist.collapse") });
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(toggle.getAttribute("aria-controls")).toBe("qcms-assist-body");
      expect(toggle.textContent).toBe("");
      const fresh = screen.getByRole("button", { name: t("forms.assist.newConversation") });
      // Nothing to clear yet.
      expect((fresh as HTMLButtonElement).disabled).toBe(true);
    });

    it("dismisses a hover-open tooltip on Escape with focus elsewhere, without moving focus", async () => {
      render(
        <AssistPanel
          endpoint="/forms/frm_quote/assist"
          draft={DRAFT}
          draftUpdatedAt={undefined}
          onAccept={vi.fn()}
        />,
      );
      const input = screen.getByLabelText(t("forms.assist.inputLabel"));
      input.focus();
      const toggle = screen.getByRole("button", { name: t("forms.assist.collapse") });
      fireEvent.mouseEnter(toggle.parentElement as HTMLElement);
      expect(screen.getByTestId("qcms-assist-tip")).toBeTruthy();
      fireEvent.keyDown(input, { key: "Escape" });
      await waitFor(() => {
        expect(screen.queryByTestId("qcms-assist-tip")).toBeNull();
      });
      expect(document.activeElement).toBe(input);
    });

    it("removes its document Escape listener when the tooltip closes or unmounts", () => {
      const added = vi.spyOn(document, "addEventListener");
      const removed = vi.spyOn(document, "removeEventListener");
      const { unmount } = render(
        <AssistPanel
          endpoint="/forms/frm_quote/assist"
          draft={DRAFT}
          draftUpdatedAt={undefined}
          onAccept={vi.fn()}
        />,
      );
      const toggle = screen.getByRole("button", { name: t("forms.assist.collapse") });
      fireEvent.focus(toggle);
      const keydownAdds = added.mock.calls.filter(([type]) => type === "keydown");
      expect(keydownAdds).toHaveLength(1);
      const handler = keydownAdds[0]?.[1];
      unmount();
      expect(removed).toHaveBeenCalledWith("keydown", handler);
    });

    it("shows a tooltip on focus and hover, and Escape dismisses it", async () => {
      render(
        <AssistPanel
          endpoint="/forms/frm_quote/assist"
          draft={DRAFT}
          draftUpdatedAt={undefined}
          onAccept={vi.fn()}
        />,
      );
      const toggle = screen.getByRole("button", { name: t("forms.assist.collapse") });
      expect(screen.queryByTestId("qcms-assist-tip")).toBeNull();
      fireEvent.focus(toggle);
      expect(screen.getByTestId("qcms-assist-tip").textContent).toBe(t("forms.assist.collapse"));
      fireEvent.keyDown(toggle, { key: "Escape" });
      expect(screen.queryByTestId("qcms-assist-tip")).toBeNull();
      fireEvent.blur(toggle);
      fireEvent.mouseEnter(toggle.parentElement as HTMLElement);
      expect(screen.getByTestId("qcms-assist-tip")).toBeTruthy();
      // Leaving closes it after a short delay rather than at once, so a pointer on its
      // way to the tooltip does not lose it.
      fireEvent.mouseLeave(toggle.parentElement as HTMLElement);
      expect(screen.getByTestId("qcms-assist-tip")).toBeTruthy();
      await waitFor(() => {
        expect(screen.queryByTestId("qcms-assist-tip")).toBeNull();
      });
    });

    it("collapses and expands from the keyboard-operable toggle", () => {
      render(
        <AssistPanel
          endpoint="/forms/frm_quote/assist"
          draft={DRAFT}
          draftUpdatedAt={undefined}
          onAccept={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: t("forms.assist.collapse") }));
      expect(screen.queryByLabelText(t("forms.assist.inputLabel"))).toBeNull();
      const expand = screen.getByRole("button", { name: t("forms.assist.expand") });
      expect(expand.tagName).toBe("BUTTON");
      expect(expand.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(expand);
      expect(screen.getByLabelText(t("forms.assist.inputLabel"))).toBeTruthy();
    });

    it("starts a new conversation, clearing the turns and the card", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(sseBody([frame("text", { delta: "Hello." })]), {
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
      sendMessage("Hi");
      const fresh = screen.getByRole("button", { name: t("forms.assist.newConversation") });
      await waitFor(() => {
        expect((fresh as HTMLButtonElement).disabled).toBe(false);
      });
      fireEvent.click(fresh);
      expect(screen.queryByTestId("qcms-assist-conversation")).toBeNull();
      expect(screen.getByText(t("forms.assist.emptyHint"))).toBeTruthy();
    });
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

function renderPanel(onAccept = vi.fn()) {
  return render(
    <AssistPanel
      endpoint="/forms/frm_quote/assist"
      draft={DRAFT}
      draftUpdatedAt={undefined}
      onAccept={onAccept}
    />,
  );
}

function composer(): HTMLElement {
  return screen.getByLabelText(t("forms.assist.inputLabel"));
}

/** A proposal frame over the fixture draft, with one added step. */
function proposalFrame(): string {
  return frame("proposal", {
    proposal: {
      proposedDraft: {
        ...DRAFT,
        steps: [...DRAFT.steps, { stepId: "stp_history", title: { en: "Driving history" }, items: [] }],
      },
      newQuestions: [],
      rationale: "Added a driving-history step.",
      issues: [],
      warnings: [],
    },
  });
}

/**
 * A `fetch` stub for a turn that is still running: it writes the given frames
 * and then leaves the body open until the request's signal aborts, which is what
 * a real streaming response does. Without the abort half, Stop would be asserted
 * against a stub that ignores it and the panel could never leave its working
 * state in the test.
 */
function openTurn(
  capture: (signal: AbortSignal | undefined) => void,
  frames: readonly string[] = [frame("text", { delta: "Working" })],
) {
  return (_url: string, init: RequestInit) => {
    const signal = init.signal ?? undefined;
    capture(signal);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frames.join("")));
        signal?.addEventListener("abort", () => {
          controller.error(new DOMException("aborted", "AbortError"));
        });
      },
    });
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
  };
}

function stubFetch(frames: readonly string[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(sseBody(frames), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    ),
  );
}

/** The composer (080 exit criterion 5, `plan/agent-everywhere.md` section 4.3). */
describe("AssistPanel composer", () => {
  it("is a multi-line area where Enter sends", () => {
    stubFetch([frame("text", { delta: "On it." })]);
    renderPanel();

    const area = composer();
    expect(area.tagName).toBe("TEXTAREA");
    fireEvent.change(area, { target: { value: "Add a step" } });
    fireEvent.keyDown(area, { key: "Enter" });

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(fetch).mock.calls[0]?.[1]?.body;
    expect(typeof sent).toBe("string");
    const body: unknown = JSON.parse(typeof sent === "string" ? sent : "{}");
    expect(body).toMatchObject({ conversation: [{ role: "user", content: "Add a step" }] });
  });

  it("leaves Shift+Enter to the browser, so it inserts a newline and sends nothing", () => {
    stubFetch([frame("text", { delta: "On it." })]);
    renderPanel();

    const area = composer();
    fireEvent.change(area, { target: { value: "First line" } });
    const event = fireEvent.keyDown(area, { key: "Enter", shiftKey: true });

    // Not prevented, which is what lets the textarea do its own thing with it.
    expect(event).toBe(true);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("leaves Enter alone while an input method is composing", () => {
    stubFetch([frame("text", { delta: "On it." })]);
    renderPanel();

    const area = composer();
    fireEvent.change(area, { target: { value: "日本語" } });
    fireEvent.keyDown(area, { key: "Enter", isComposing: true });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  /**
   * Stop (section 4.3).
   *
   * Aborting the `fetch` is the whole mechanism, so the assertion is that the
   * signal the request was made with is aborted - and that the turn does not
   * then report itself as a provider failure, which is what an abort looks like
   * from inside the read loop.
   */
  it("shows Stop only while a turn runs, and aborts the request", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(openTurn((s) => (signal = s))));

    renderPanel();
    expect(screen.queryByTestId("qcms-assist-stop")).toBeNull();

    fireEvent.change(composer(), { target: { value: "Add a step" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    const stop = await screen.findByRole("button", { name: t("forms.assist.stop") });
    fireEvent.click(stop);

    await waitFor(() => {
      expect(signal?.aborted).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("qcms-assist-stop")).toBeNull();
    });
    // A turn the author ended is not a failure to report.
    expect(screen.queryByTestId("qcms-assist-error")).toBeNull();
  });
});

/** Focus (080 exit criterion 6, section 4.4). */
describe("AssistPanel focus", () => {
  it("leaves focus where it was when a card arrives from outside the panel", async () => {
    stubFetch([proposalFrame()]);
    const outside = document.createElement("button");
    document.body.append(outside);
    renderPanel();

    fireEvent.change(composer(), { target: { value: "Add a step" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    // The author goes back to the page while the turn runs.
    outside.focus();

    await waitFor(() => {
      expect(screen.getByTestId("qcms-assist-proposal")).toBeTruthy();
    });
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("moves focus to the card heading when a card arrives with focus inside the panel", async () => {
    stubFetch([proposalFrame()]);
    renderPanel();

    fireEvent.change(composer(), { target: { value: "Add a step" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    composer().focus();

    const heading = await screen.findByRole("heading", { name: t("forms.assist.proposalHeading") });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
  });

  it("moves focus to the outcome line after Accept, and keeps the line in the record", async () => {
    stubFetch([proposalFrame()]);
    const onAccept = vi.fn();
    renderPanel(onAccept);

    fireEvent.change(composer(), { target: { value: "Add a step" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByTestId("qcms-assist-proposal")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: t("forms.assist.accept") }));

    expect(onAccept).toHaveBeenCalledTimes(1);
    const line = await screen.findByTestId("qcms-assist-result");
    expect(line.textContent).toBe(t("forms.assist.resultAccepted"));
    await waitFor(() => {
      expect(document.activeElement).toBe(line);
    });
    // The card is gone and the record of it is not.
    expect(screen.queryByTestId("qcms-assist-proposal")).toBeNull();
  });

  it("moves focus to the outcome line after Discard", async () => {
    stubFetch([proposalFrame()]);
    renderPanel();

    fireEvent.change(composer(), { target: { value: "Add a step" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByTestId("qcms-assist-proposal")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: t("forms.assist.discard") }));

    const line = await screen.findByTestId("qcms-assist-result");
    expect(line.textContent).toBe(t("forms.assist.resultDiscarded"));
    await waitFor(() => {
      expect(document.activeElement).toBe(line);
    });
  });

  it("moves nothing when a turn simply ends", async () => {
    stubFetch([frame("text", { delta: "Here is what I found." })]);
    renderPanel();

    fireEvent.change(composer(), { target: { value: "Tell me" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    const before = document.activeElement;

    await waitFor(() => {
      expect(screen.getByText("Here is what I found.")).toBeTruthy();
    });
    expect(document.activeElement).toBe(before);
  });
});

/**
 * The thinking disclosure (081 exit criteria 1, 2 and 5).
 *
 * The panel knows nothing about `QCMS_AGENT_THINKING` (ADR-24), so every case
 * here is stated in terms of the events: the disclosure exists when reasoning
 * frames arrive and does not when they do not, which is exactly what the
 * operator setting decides on the API's side.
 */
describe("AssistPanel thinking disclosure", () => {
  it("renders nothing when no reasoning frame arrives", async () => {
    stubFetch([frame("text", { delta: "Here is the draft." })]);
    renderPanel();

    fireEvent.change(composer(), { target: { value: "Go" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Here is the draft.")).toBeTruthy();
    });
    expect(screen.queryByTestId("qcms-assist-thinking")).toBeNull();
  });

  it("renders collapsed, in plain text, with a duration once the summary ends", async () => {
    stubFetch([
      frame("reasoning", { delta: "Checking **one** thing first.\nThen the other." }),
      frame("reasoning-end", {}),
      frame("text", { delta: "Here is the draft." }),
    ]);
    renderPanel();

    fireEvent.change(composer(), { target: { value: "Go" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    const disclosure = await screen.findByTestId("qcms-assist-thinking");
    // Collapsed: the summary is working-out, not the reply.
    expect((disclosure as HTMLDetailsElement).open).toBe(false);
    expect(disclosure.textContent).toContain(t("forms.assist.thinking"));

    // Plain text, never Markdown: the asterisks are characters, and nothing
    // became an element.
    expect(disclosure.textContent).toContain("**one**");
    expect(disclosure.querySelector("strong")).toBeNull();
    expect(disclosure.querySelector(".qcms-assist-md")).toBeNull();

    // And the duration replaces the running indicator once it has ended.
    await waitFor(() => {
      expect(disclosure.textContent).toMatch(/Thought for \d+ s/u);
    });
    expect(disclosure.querySelector(".qcms-assist-think__pulse")).toBeNull();
  });

  it("shows the running indicator while the summary is still arriving", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        openTurn(
          () => undefined,
          [frame("reasoning", { delta: "weighing it up" })],
        ),
      ),
    );
    renderPanel();

    fireEvent.change(composer(), { target: { value: "Go" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    const disclosure = await screen.findByTestId("qcms-assist-thinking");
    expect(disclosure.querySelector(".qcms-assist-think__pulse")).not.toBeNull();
    expect(disclosure.textContent).not.toMatch(/Thought for/u);
  });

  it("keeps the summary out of the conversation the API is sent next", async () => {
    stubFetch([
      frame("reasoning", { delta: "SENTINEL-REASONING" }),
      frame("reasoning-end", {}),
      frame("text", { delta: "Here is the draft." }),
    ]);
    renderPanel();

    fireEvent.change(composer(), { target: { value: "First" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByText("Here is the draft.")).toBeTruthy();
    });

    fireEvent.change(composer(), { target: { value: "Second" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    });
    const sent = vi.mocked(fetch).mock.calls[1]?.[1]?.body;
    expect(typeof sent === "string" ? sent : "").not.toContain("SENTINEL-REASONING");
  });
});

/** The assistant's identity (080 exit criterion 9, issue #1129). */
describe("AssistPanel identity", () => {
  it("names the panel from the header mark, with no visible title word", () => {
    renderPanel();

    const panel = screen.getByTestId("qcms-assist-panel");
    const labelledBy = panel.getAttribute("aria-labelledby");
    expect(labelledBy).toBe("qcms-assist-heading");

    const named = document.getElementById(labelledBy ?? "");
    expect(named?.getAttribute("role")).toBe("img");
    expect(named?.getAttribute("aria-label")).toBe(t("agent.title"));
    // The word is the mark's name, not text on screen.
    expect(named?.textContent).toBe("");
    expect(screen.queryByRole("heading", { name: t("agent.title") })).toBeNull();
  });

  it("gives each assistant turn the mark as its avatar", async () => {
    stubFetch([frame("text", { delta: "Looking now." })]);
    renderPanel();

    fireEvent.change(composer(), { target: { value: "Go" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Looking now.")).toBeTruthy();
    });
    // Two: the header's and the turn's.
    expect(screen.getAllByRole("img", { name: t("agent.title") })).toHaveLength(2);
  });

  it("carries the working state exactly while the live region reports a running turn", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        openTurn(
          () => undefined,
          [frame("status", { phase: "thinking" })],
        ),
      ),
    );

    renderPanel();
    const header = () => screen.getAllByTestId("qcms-assist-mark")[0];
    expect(header()?.getAttribute("data-working")).toBeNull();

    fireEvent.change(composer(), { target: { value: "Go" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    await waitFor(() => {
      expect(header()?.getAttribute("data-working")).toBe("true");
    });
    // The same state the polite region is reporting, in words.
    expect(screen.getByTestId("qcms-assist-status").textContent).toBe(t("forms.assist.working"));

    fireEvent.click(screen.getByRole("button", { name: t("forms.assist.stop") }));
    await waitFor(() => {
      expect(header()?.getAttribute("data-working")).toBeNull();
    });
  });
});
