import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DraftPreviewState } from "../../lib/forms/builder-state.ts";
import type { DraftForm } from "../../lib/forms/types.ts";
import { t } from "../../lib/i18n/en.ts";

let wireBody: Record<string, unknown> = {};

vi.mock("../../lib/server/api.ts", () => ({
  adminApiFetch: () =>
    Promise.resolve(
      new Response(JSON.stringify(wireBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
}));

const { DraftPreview } = await import("./draft-preview.tsx");
const { previewDraft } = await import("../../lib/server/forms.ts");

const SESSION: Parameters<typeof previewDraft>[0] = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  mustChangePassword: false,
  token: "tok",
};

const ROSTER = ["ins_p1", "ins_p2", "ins_p3"] as const;

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

function wire(visibleStepViews: readonly unknown[]): Record<string, unknown> {
  return {
    documents: [PAX_STEP],
    compilerVersion: "0.1.0",
    a2uiSpecVersion: "1.0.0",
    flow: {
      visibleSteps: [PAX_STEP.stepId],
      visibleQuestions: ROSTER.map((instanceId) => `${instanceId}/q_pax_name`),
      complete: false,
      rosters: [{ groupId: "grp_pax", instances: [...ROSTER] }],
      visibleStepViews,
    },
  };
}

async function preview(input: {
  readonly draft: DraftForm;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly instances: Readonly<Record<string, readonly string[]>>;
}): Promise<DraftPreviewState> {
  const result = await previewDraft(SESSION, input.draft.formId, {
    definition: input.draft,
    answers: input.answers,
    instances: input.instances,
  });
  return result.ok
    ? { status: "ok", preview: result.data }
    : { status: "error", message: result.message };
}

function drawnFields(): string[] {
  const surface = screen.getByTestId("qcms-preview-surface");
  return Array.from(surface.querySelectorAll<HTMLElement>("[data-qcms-field]")).map(
    (element) => element.dataset.qcmsField ?? "",
  );
}

describe("a per-instance page in the draft preview", () => {
  it("draws only its own instance and names it in the step line", async () => {
    wireBody = wire(ROSTER.map((instanceId) => ({ stepId: PAX_STEP.stepId, instanceId })));
    const user = userEvent.setup();
    render(<DraftPreview draft={DRAFT} defaultTheme="slate" preview={preview} />);

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
    wireBody = wire([{ stepId: PAX_STEP.stepId, instanceId: null }]);
    render(<DraftPreview draft={stacked} defaultTheme="slate" preview={preview} />);

    const line = await screen.findByTestId("qcms-preview-step");
    expect(line.textContent).toBe(
      t("forms.preview.stepOf", { index: 1, total: 1, title: "Passengers" }),
    );
    expect(drawnFields()).toEqual(ROSTER.map((instanceId) => `${instanceId}/q_pax_name`));
  });
});
