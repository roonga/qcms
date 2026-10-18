import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DraftPreview } from "./draft-preview.tsx";
import type { DraftForm, DraftPreview as DraftPreviewPayload } from "../../lib/forms/types.ts";
import { t } from "../../lib/i18n/en.ts";

/**
 * A "One page per instance" group in the draft preview (task 076, local UX list A2).
 *
 * The pane walks views rather than steps, and a per-instance view has to draw ONE instance
 * of the group, through the same renderer `view` option the portal passes, and say which
 * instance it is in the step line. Before this the pane walked the right number of pages
 * and drew every instance on each of them.
 *
 * Everything below the `preview` prop is real: the view list, the narrowing, the shared
 * projection and the shared renderer.
 */

const ROSTER = ["ins_p1", "ins_p2", "ins_p3"] as const;

/** One compiled step shaped as the compiler emits a group: a template carrying its member once. */
const PAX_STEP = {
  stepId: "stp_pax",
  root: {
    type: "Form",
    children: [
      { type: "Text", props: { as: "h2" }, children: "Passengers" },
      {
        type: "RepeatGroup",
        props: {
          groupId: "grp_pax",
          label: "Passengers",
          instanceLabel: "Passenger {n}",
          presentation: "perInstanceStep",
          countSource: "fixed",
          min: 3,
          max: 3,
        },
        children: [{ type: "TextField", props: { label: "Full name", name: "q_pax_name" } }],
      },
    ],
  },
};

const DRAFT: DraftForm = {
  formId: "frm_trip",
  defaultLocale: "en",
  title: { en: "Trip" },
  steps: [
    {
      stepId: PAX_STEP.stepId,
      title: { en: "Passengers" },
      items: [
        {
          groupId: "grp_pax",
          label: { en: "Passengers" },
          instanceLabel: { en: "Passenger {n}" },
          items: [{ questionId: "q_pax_name", version: 1 }],
          count: { source: "fixed", count: 3 },
          presentation: "perInstanceStep",
        },
      ],
    },
  ],
  rules: [],
};

const PREVIEW: DraftPreviewPayload = {
  documents: [PAX_STEP],
  compilerVersion: "0.1.0",
  a2uiSpecVersion: "1.0.0",
  flow: {
    visibleSteps: [PAX_STEP.stepId],
    visibleQuestions: ROSTER.map((instanceId) => `${instanceId}/q_pax_name`),
    complete: false,
    rosters: [{ groupId: "grp_pax", instances: [...ROSTER] }],
    visibleStepViews: ROSTER.map((instanceId) => ({ stepId: PAX_STEP.stepId, instanceId })),
  },
};

function drawnFields(): string[] {
  const surface = screen.getByTestId("qcms-preview-surface");
  return Array.from(surface.querySelectorAll<HTMLElement>("[data-qcms-field]")).map(
    (element) => element.dataset.qcmsField ?? "",
  );
}

describe("a per-instance page in the draft preview", () => {
  it("draws only its own instance and names it in the step line", async () => {
    const user = userEvent.setup();
    render(
      <DraftPreview
        draft={DRAFT}
        defaultTheme="slate"
        preview={() => Promise.resolve({ status: "ok", preview: PREVIEW })}
      />,
    );

    const line = await screen.findByTestId("qcms-preview-step");
    expect(line.textContent).toBe(
      t("forms.preview.stepOfInstance", {
        index: 1,
        total: 3,
        title: "Passengers",
        instance: "Passenger 1",
      }),
    );
    const surface = screen.getByTestId("qcms-preview-surface");
    expect(surface.querySelectorAll("[data-qcms-instance]")).toHaveLength(1);
    expect(drawnFields()).toEqual(["ins_p1/q_pax_name"]);

    await user.click(screen.getByRole("button", { name: t("forms.preview.next") }));

    expect(screen.getByTestId("qcms-preview-step").textContent).toBe(
      t("forms.preview.stepOfInstance", {
        index: 2,
        total: 3,
        title: "Passengers",
        instance: "Passenger 2",
      }),
    );
    // Passenger 2 alone, and still called Passenger 2: the ordinal is its place in the full
    // roster rather than in the one-element list the page draws.
    expect(surface.querySelectorAll("[data-qcms-instance]")).toHaveLength(1);
    expect(within(surface).getByRole("heading", { name: "Passenger 2" })).toBeTruthy();
    expect(drawnFields()).toEqual(["ins_p2/q_pax_name"]);
  });

  it("keeps the plain step line, and every instance, for a stacked group", async () => {
    const stacked: DraftForm = {
      ...DRAFT,
      steps: DRAFT.steps.map((step) => ({
        ...step,
        items: step.items.map((item) => ({ ...item, presentation: "stacked" as const })),
      })),
    };
    const flow = {
      visibleSteps: PREVIEW.flow.visibleSteps,
      visibleQuestions: PREVIEW.flow.visibleQuestions,
      complete: false,
      rosters: PREVIEW.flow.rosters,
      visibleStepViews: [{ stepId: PAX_STEP.stepId, instanceId: null }],
    };
    render(
      <DraftPreview
        draft={stacked}
        defaultTheme="slate"
        preview={() => Promise.resolve({ status: "ok", preview: { ...PREVIEW, flow } })}
      />,
    );

    const line = await screen.findByTestId("qcms-preview-step");
    expect(line.textContent).toBe(
      t("forms.preview.stepOf", { index: 1, total: 1, title: "Passengers" }),
    );
    expect(drawnFields()).toEqual(ROSTER.map((instanceId) => `${instanceId}/q_pax_name`));
  });
});
