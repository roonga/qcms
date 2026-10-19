import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import type { NativeSubmitOptions } from "./native-submit.ts";
import { qualifiedFieldName, ROSTER_OP_FIELD } from "./repeat/index.ts";
import { axeViolations } from "./test-support/a11y.ts";
import { loadGoldenForms } from "./test-support/golden.ts";

/**
 * The no-JS implicit-submission default (local UX list P3).
 *
 * Without scripting, Enter in a text, number or date field presses the form's default
 * button, which HTML defines as the first submit button in tree order. The real
 * Continue is appended last, after every `__qop` Remove and the group's Add, so on a
 * repeating step Enter used to remove the first instance or add one. A hidden copy of
 * Continue now comes first. These cases pin that it precedes every roster button, that
 * it mirrors the real control, that a respondent cannot meet it, and that nothing else
 * moves: a step with no group and the scripted path render exactly as before.
 */

const ACTION = "/s/ses_1/step";

function goldenStep(form: string, stepId: string): { document: A2UIStepDocument; spec: string } {
  const golden = loadGoldenForms().find((entry) => entry.version === "v4" && entry.form === form);
  if (golden === undefined) throw new Error(`no v4 golden for ${form}`);
  const document = golden.compiled.documents.find((doc) => doc.stepId === stepId);
  if (document === undefined) throw new Error(`no step ${stepId} in ${form}`);
  return { document, spec: golden.compiled.a2uiSpecVersion };
}

const ROSTER = ["ins_a1", "ins_a2"];

function renderStacked(nativeSubmit?: NativeSubmitOptions) {
  const { document, spec } = goldenStep("repeat-open-group", "stp_fleet");
  return render(
    <A2UIStepRenderer
      document={document}
      specVersion={spec}
      repeat={{ rosters: { grp_vehicles: ROSTER }, opToken: "op_7f3" }}
      {...(nativeSubmit === undefined ? {} : { nativeSubmit })}
    />,
  );
}

function submitButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('form button[type="submit"]'));
}

function precedes(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe("the implicit-submission default on a repeating step (local UX list P3)", () => {
  it("is the form's first submit button, ahead of every Remove and Add", () => {
    const { container } = renderStacked({ action: ACTION, submitLabel: "Continue" });
    const buttons = submitButtons(container);
    const roster = buttons.filter((button) => button.name === ROSTER_OP_FIELD);
    // Two Removes and an Add, so the case the defect needed is present.
    expect(roster).toHaveLength(3);
    const first = buttons[0];
    expect(first.hasAttribute("data-qcms-implicit-submit")).toBe(true);
    for (const button of roster) expect(precedes(first, button)).toBe(true);
    // The real control is still the last one, where a respondent reaches it.
    const real = buttons.at(-1)!;
    expect(real.hasAttribute("data-qcms-implicit-submit")).toBe(false);
    expect(buttons.filter((b) => b.hasAttribute("data-qcms-implicit-submit"))).toHaveLength(1);
  });

  it("mirrors the real control's label, name, value and formaction", () => {
    const { container } = renderStacked({
      action: ACTION,
      submitLabel: "Submit",
      submitClassName: "btn-primary",
    });
    const buttons = submitButtons(container);
    const hidden = buttons[0];
    const real = buttons.at(-1)!;
    // The single readiness-labelled button (ADR-28 as amended 2026-08-31): whatever label
    // the host passes, the copy carries the same one.
    expect(hidden.textContent).toBe("Submit");
    expect(real.textContent).toBe("Submit");
    expect(hidden.getAttribute("name")).toBe(real.getAttribute("name"));
    expect(hidden.getAttribute("value")).toBe(real.getAttribute("value"));
    expect(hidden.getAttribute("formaction")).toBe(real.getAttribute("formaction"));
    // Validated like Continue, unlike the roster buttons.
    expect(hidden.hasAttribute("formnovalidate")).toBe(false);
  });

  it("carries Continue's formaction when the form's own action is a Server Action", () => {
    const { container } = renderStacked({
      action: ACTION,
      submitLabel: "Continue",
      formAction: () => {},
      hiddenFields: { __qsid: "ses_1" },
    });
    const buttons = submitButtons(container);
    const hidden = buttons[0];
    const real = buttons.at(-1)!;
    expect(hidden.hasAttribute("data-qcms-implicit-submit")).toBe(true);
    expect(real.getAttribute("formaction")).toBe(ACTION);
    expect(hidden.getAttribute("formaction")).toBe(ACTION);
  });

  it("is out of the tab order and the accessibility tree", async () => {
    const { container } = renderStacked({ action: ACTION, submitLabel: "Continue" });
    const hidden = submitButtons(container)[0];
    expect(hidden.getAttribute("aria-hidden")).toBe("true");
    expect(hidden.tabIndex).toBe(-1);
    expect(screen.getAllByRole("button", { name: "Continue" })).toHaveLength(1);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("is what Enter in a member field submits", async () => {
    const { container } = renderStacked({ action: ACTION, submitLabel: "Continue" });
    const form = container.querySelector("form")!;
    // Implicit submission is a synthetic click on the default button, so the click is
    // what is recorded. The submission itself is then refused by constraint validation,
    // because other required members are blank, which is Continue's behaviour too.
    const pressed: HTMLElement[] = [];
    form.addEventListener(
      "click",
      (event) => {
        if (event.target instanceof HTMLButtonElement) pressed.push(event.target);
      },
      true,
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
    });
    const plate = container.querySelector<HTMLInputElement>(
      `input[name="${qualifiedFieldName(ROSTER[0], "q_rep_plate")}"]`,
    )!;
    await userEvent.type(plate, "AAA111{Enter}");
    expect(pressed).toHaveLength(1);
    expect(pressed[0].hasAttribute("data-qcms-implicit-submit")).toBe(true);
  });

  it("precedes the Remove of every table row too", () => {
    const { document, spec } = goldenStep("repeat-table-group", "stp_fleet_table");
    const { container } = render(
      <A2UIStepRenderer
        document={document}
        specVersion={spec}
        repeat={{ rosters: { grp_vehicles: ["ins_t1", "ins_t2"] }, opToken: "op_7f3" }}
        nativeSubmit={{ action: ACTION, submitLabel: "Continue" }}
      />,
    );
    const buttons = submitButtons(container);
    const roster = buttons.filter((button) => button.name === ROSTER_OP_FIELD);
    expect(roster.length).toBeGreaterThan(0);
    expect(buttons[0].hasAttribute("data-qcms-implicit-submit")).toBe(true);
    for (const button of roster) expect(precedes(buttons[0], button)).toBe(true);
  });
});

describe("what the default does not touch", () => {
  it("adds nothing to a native step with no repeating group", () => {
    const { document, spec } = goldenStep("minimal", "stp_only");
    const { container } = render(
      <A2UIStepRenderer
        document={document}
        specVersion={spec}
        nativeSubmit={{ action: ACTION, submitLabel: "Continue" }}
      />,
    );
    expect(submitButtons(container)).toHaveLength(1);
    expect(container.querySelector("[data-qcms-implicit-submit]")).toBeNull();
  });

  it("adds nothing on the scripted path", () => {
    const { container } = renderStacked();
    expect(container.querySelector("[data-qcms-implicit-submit]")).toBeNull();
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(0);
  });
});
