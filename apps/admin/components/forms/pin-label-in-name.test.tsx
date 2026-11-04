import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n/en";

import type { DraftForm, DraftStep, PinnableQuestion } from "../../lib/forms/types.ts";

import { StepEditor } from "./step-editor.tsx";

const DEFINITION = {
  questionId: "q_at_fault_accident",
  type: "boolean" as const,
  label: { en: "Were you at fault?" },
};

const LIBRARY: readonly PinnableQuestion[] = [
  {
    questionId: "q_at_fault_accident",
    slug: "at-fault-accident",
    label: { en: "Were you at fault?" },
    type: "boolean",
    versions: [
      { version: 1, status: "published", definition: DEFINITION },
      { version: 3, status: "published", definition: DEFINITION },
    ],
  },
];

const STEP: DraftStep = {
  stepId: "stp_history",
  title: { en: "Driving history" },
  items: [{ questionId: "q_at_fault_accident", version: 3 }],
};

const DRAFT: DraftForm = {
  formId: "frm_vehicle_insurance",
  defaultLocale: "en",
  title: { en: "Vehicle insurance" },
  steps: [STEP],
  rules: [],
};

function renderStep(): HTMLElement {
  return render(
    <StepEditor
      draft={DRAFT}
      step={STEP}
      library={{ ok: true, data: LIBRARY }}
      issues={[]}
      onAddPins={() => undefined}
      onMovePin={() => undefined}
      onRemovePin={() => undefined}
      onReorderPin={() => undefined}
      onAddGroup={() => undefined}
      onOpenGroup={() => undefined}
      onMoveGroup={() => undefined}
      onRemoveGroup={() => undefined}
    />,
  ).container;
}

const UNPAINTED = ["[hidden]", ".qcms-visually-hidden"].join(",");

const DISPLAY_NONE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:;|$)/i;

const SPEAKABLE = /[\p{L}\p{N}]/u;

function isUnpainted(element: Element): boolean {
  if (element.matches(UNPAINTED)) return true;
  const style = element.getAttribute("style");
  return style !== null && DISPLAY_NONE.test(style);
}

function isIconOnly(element: Element): boolean {
  return !SPEAKABLE.test(element.textContent ?? "");
}

function visibleText(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  for (const candidate of copy.querySelectorAll("*")) {
    if (isUnpainted(candidate) || isIconOnly(candidate)) candidate.remove();
  }
  const text = (copy.textContent ?? "").replace(/\s+/g, " ").trim();
  return SPEAKABLE.test(text) ? text : "";
}

function startsWith(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
}

describe("what the sweep counts as visible text", () => {
  function textOf(html: string): string {
    const host = document.createElement("div");
    host.innerHTML = html;
    return visibleText(host);
  }

  it("counts text painted inside an aria-hidden subtree (issue #1010)", () => {
    expect(textOf(`<span aria-hidden="true">RM</span>`)).toBe("RM");
    expect(textOf(`<span aria-hidden="true">v3</span> <span>Move pin</span>`)).toBe("v3 Move pin");
  });

  it("does not count text that is genuinely not painted", () => {
    expect(textOf(`<span class="qcms-visually-hidden">Select Driving history</span>`)).toBe("");
    expect(textOf(`<span hidden>Draft</span>`)).toBe("");
    expect(textOf(`<span style="display: none">Draft</span>`)).toBe("");
    expect(textOf(`<span style="visibility:hidden">Draft</span>`)).toBe("");
  });

  it("does not count an icon, whether it is a glyph or an svg", () => {
    expect(textOf(`<span aria-hidden="true">⋮</span>`)).toBe("");
    expect(textOf(`<span aria-hidden="true">?</span>`)).toBe("");
    expect(textOf(`<svg aria-hidden="true"><path d="M1 1l4 4"></path></svg>`)).toBe("");
    expect(textOf(`<span>Add step</span><span aria-hidden="true">⋮</span>`)).toBe("Add step");
  });
});

describe("the step editor's controls satisfy label-in-name (WCAG 2.5.3)", () => {
  it("names the pin's version control with the version it displays", () => {
    const container = renderStep();
    const scope = within(container);

    const visible = t("forms.step.pinVersion", { version: 3 });
    const trigger = scope.getByRole("button", { name: startsWith(visible) });

    expect(visibleText(trigger)).toBe(visible);
    expect(
      scope.getByRole("button", {
        name: t("forms.step.movePin", { versionLabel: visible, questionId: "q_at_fault_accident" }),
      }),
    ).toBe(trigger);
  });

  it("starts every visible-text control's accessible name with that text", () => {
    const container = renderStep();
    const scope = within(container);
    const checked: string[] = [];

    for (const button of scope.getAllByRole("button")) {
      const visible = visibleText(button);
      if (visible === "") {
        expect(button.getAttribute("aria-label")).not.toBe(null);
        continue;
      }
      expect(scope.getAllByRole("button", { name: startsWith(visible) })).toContain(button);
      checked.push(visible);
    }

    expect(checked).toContain(t("forms.step.pinVersion", { version: 3 }));
  });
});
