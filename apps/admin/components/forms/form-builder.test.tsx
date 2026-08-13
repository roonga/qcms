// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FormDetail } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

import { FormBuilder } from "./form-builder";

/**
 * Task 041: the builder's own wiring of the assist panel and its Accept path.
 *
 * The panel's own states (streaming, errors, the diff) belong to `assist-panel.test.tsx` -
 * a pure component test does not need a whole builder around it. What only the builder can
 * prove is the two facts task 041 actually cares about here: the panel is entirely absent
 * (not hidden) when the page never hands down an `assist` prop, and accepting a proposal
 * goes through the builder's own autosave path rather than any shortcut - the same
 * `saveDraft` call every other edit makes, just with `agentAssisted: true` on the one save
 * that follows an Accept.
 */

const DETAIL: FormDetail = {
  formId: "frm_quote",
  slug: "vehicle-insurance-quote",
  defaultLocale: "en",
  status: "open",
  draft: {
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
  },
  draftSource: "open",
  versions: [],
  settings: { challengeRequired: false, minSubmitMs: null },
  challengeProvider: "none",
  draftAgentAssisted: false,
  draftUpdatedAt: null,
};

function builderActions() {
  return {
    saveDraft: vi.fn().mockResolvedValue({ status: "saved" as const, issues: [] }),
    validateDraft: vi.fn().mockResolvedValue({ status: "ok" as const, valid: true, issues: [] }),
    updateSettings: vi.fn(),
    previewCondition: vi.fn(),
  };
}

function frame(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

function sseBody(frames: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(frames.join("")));
      controller.close();
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FormBuilder and the assist panel (task 041)", () => {
  it("renders no assist panel, and no assist affordance, when the assist prop is absent", () => {
    render(<FormBuilder detail={DETAIL} library={[]} {...builderActions()} />);
    expect(screen.queryByTestId("qcms-assist-panel")).toBeNull();
    expect(screen.queryByText(t("forms.assist.title"))).toBeNull();
    expect(screen.queryByLabelText(t("forms.assist.inputLabel"))).toBeNull();
  });

  it("renders the assist panel when the assist prop is present", () => {
    render(
      <FormBuilder
        detail={DETAIL}
        library={[]}
        {...builderActions()}
        assist={{ endpoint: "/forms/frm_quote/assist" }}
      />,
    );
    expect(screen.getByTestId("qcms-assist-panel")).toBeTruthy();
  });

  it("saves an accepted proposal through the builder's own autosave path, agentAssisted: true", async () => {
    const actions = builderActions();
    const proposal = {
      proposal: {
        proposedDraft: {
          ...DETAIL.draft,
          // Renames the existing step rather than adding a new (necessarily empty,
          // since the proposal introduces no pin for it) one: an empty step pauses
          // autosave outright (`unsaveableReason`), which would make this test
          // exercise that pause instead of the accept-then-save path it is for.
          steps: [
            {
              ...(DETAIL.draft?.steps[0] ?? { stepId: "", title: {}, items: [] }),
              title: { en: "Basics (renamed)" },
            },
          ],
        },
        newQuestions: [],
        rationale: "Renamed a step.",
        issues: [],
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
      <FormBuilder
        detail={DETAIL}
        library={[]}
        {...actions}
        assist={{ endpoint: "/forms/frm_quote/assist" }}
      />,
    );

    const input = screen.getByLabelText(t("forms.assist.inputLabel"));
    fireEvent.change(input, { target: { value: "Add a step" } });
    fireEvent.click(screen.getByRole("button", { name: t("forms.assist.send") }));

    await waitFor(() => expect(screen.getByTestId("qcms-assist-proposal")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: t("forms.assist.accept") }));

    // The accepted draft is stored by the builder's ordinary debounced autosave
    // (`AUTOSAVE_DEBOUNCE_MS`), not by an immediate call Accept makes itself.
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalled(), { timeout: 2000 });

    const call = actions.saveDraft.mock.calls[0] as [
      { steps: readonly { stepId: string; title: Record<string, string> }[] },
      boolean,
    ];
    const [savedDraft, agentAssisted] = call;
    expect(agentAssisted).toBe(true);
    expect(savedDraft.steps[0]?.title["en"]).toBe("Basics (renamed)");
  });
});
