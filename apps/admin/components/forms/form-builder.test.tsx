import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FormDetail, PinnableQuestion } from "@/lib/forms/types";
import type { ReadState } from "@/lib/read-state";
import { t } from "@/lib/i18n/en";

import { useBuilderRail } from "@/lib/forms/builder-bridge";

import { FormBuilder } from "./form-builder";

/**
 * A stand-in for the app rail, which lives outside this component's tree.
 *
 * The builder publishes its selection and its handlers through
 * `lib/forms/builder-bridge.ts`, and the real rail is rendered by the shell. A test
 * that needs the builder to be showing a STEP has to press what the rail presses, so
 * this renders one button per step doing exactly that and nothing else.
 */
function RailStandIn() {
  const rail = useBuilderRail();
  if (rail === undefined) return null;
  return (
    <div>
      {rail.draft.steps.map((step) => (
        <button
          key={step.stepId}
          type="button"
          onClick={() => {
            rail.choose(step.stepId);
          }}
        >
          {`rail: ${step.stepId}`}
        </button>
      ))}
    </div>
  );
}

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
  challengeEnforceable: false,
  draftAgentAssisted: false,
  draftUpdatedAt: null,
};

/** The builder's non-assist props, none of which this file is about. */
const CHROME = {
  library: { ok: true, data: [] } as ReadState<readonly PinnableQuestion[]>,
  formActions: null,
  formMeta: null,
  concurrentNoticeRead: true,
};

function builderActions() {
  return {
    saveDraft: vi.fn().mockResolvedValue({ status: "saved" as const, issues: [], warnings: [] }),
    validateDraft: vi
      .fn()
      .mockResolvedValue({ status: "ok" as const, valid: true, issues: [], warnings: [] }),
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
    render(<FormBuilder detail={DETAIL} {...CHROME} {...builderActions()} />);
    expect(screen.queryByTestId("qcms-assist-panel")).toBeNull();
    expect(screen.queryByText(t("forms.assist.title"))).toBeNull();
    expect(screen.queryByLabelText(t("forms.assist.inputLabel"))).toBeNull();
  });

  it("renders the assist panel when the assist prop is present", () => {
    render(
      <FormBuilder
        detail={DETAIL}
        {...CHROME}
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
        {...CHROME}
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

  /**
   * Issue #823: the proposal's NEW question definitions have to reach the save.
   *
   * Before this they stopped at the diff, so accepting stored a draft pinning
   * question ids nothing had ever created. The builder is not the thing that
   * creates them - the accept endpoint is - but it is the thing that has them,
   * and dropping them here is where the defect started.
   */
  it("carries the proposal's new question definitions into the accepting save", async () => {
    const actions = builderActions();
    const newQuestion = { questionId: "q_first_name", type: "shortText", label: { en: "First" } };
    const proposal = {
      proposal: {
        proposedDraft: {
          ...DETAIL.draft,
          steps: [
            {
              ...(DETAIL.draft?.steps[0] ?? { stepId: "", title: {}, items: [] }),
              title: { en: "Basics (with a new question)" },
            },
          ],
        },
        newQuestions: [newQuestion],
        rationale: "Proposed one new question.",
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
        {...CHROME}
        {...actions}
        assist={{ endpoint: "/forms/frm_quote/assist" }}
      />,
    );

    const input = screen.getByLabelText(t("forms.assist.inputLabel"));
    fireEvent.change(input, { target: { value: "Add a name question" } });
    fireEvent.click(screen.getByRole("button", { name: t("forms.assist.send") }));

    await waitFor(() => expect(screen.getByTestId("qcms-assist-proposal")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: t("forms.assist.accept") }));

    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalled(), { timeout: 2000 });

    const [, agentAssisted, newQuestions] = actions.saveDraft.mock.calls[0] as [
      unknown,
      boolean,
      readonly unknown[],
    ];
    expect(agentAssisted).toBe(true);
    // Verbatim: the builder relays the definitions, it does not reinterpret them.
    expect(newQuestions).toEqual([newQuestion]);
  });

  /**
   * A proposal replaces the whole draft, so it can delete the step the screen is on.
   *
   * This is the one edit in the builder that can invalidate the selection wholesale -
   * every other mutation changes a part of the draft - and the browser suite is where
   * it was found: accepting left the builder on a step that no longer existed, whose
   * branch renders `null`, so the column went blank with nothing saying why. The rule
   * applied is the rail's own for a removed step: the form is the one destination that
   * is always there.
   */
  it("returns to the form when the accepted proposal deletes the step on screen", async () => {
    const proposal = {
      proposal: {
        proposedDraft: {
          ...DETAIL.draft,
          steps: [
            {
              stepId: "stp_history",
              title: { en: "Driving history" },
              items: [{ questionId: "q_name", version: 1 }],
            },
          ],
        },
        newQuestions: [],
        rationale: "Replaced the step.",
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
      <>
        <FormBuilder
          detail={DETAIL}
          {...CHROME}
          {...builderActions()}
          assist={{ endpoint: "/forms/frm_quote/assist" }}
        />
        <RailStandIn />
      </>,
    );

    // Stand on the step the proposal is about to delete. The form title field is the
    // form screen's own control, so its absence is what "showing a step" looks like.
    await waitFor(() => expect(screen.getByText("rail: stp_basics")).toBeTruthy());
    fireEvent.click(screen.getByText("rail: stp_basics"));
    await waitFor(() => expect(screen.queryByLabelText(t("forms.builder.formTitle"))).toBeNull());

    const input = screen.getByLabelText(t("forms.assist.inputLabel"));
    fireEvent.change(input, { target: { value: "Replace my step" } });
    fireEvent.click(screen.getByRole("button", { name: t("forms.assist.send") }));
    await waitFor(() => expect(screen.getByTestId("qcms-assist-proposal")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: t("forms.assist.accept") }));

    // Back on the form, not on a blank column.
    await waitFor(() => expect(screen.getByLabelText(t("forms.builder.formTitle"))).toBeTruthy());
  });
});
