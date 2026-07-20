import {
  parseBooleanAnswerValue,
  parseDateAnswerValue,
  parseMultiChoiceAnswerValue,
  parseNumberAnswerValue,
  parseSingleChoiceAnswerValue,
  parseTextAnswerValue,
} from "@qcms/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { loadGoldenForms } from "./test-support/golden.ts";
import { ControlledHost, useChanges } from "./test-support/host.tsx";

// Controlled round-trip (exit criterion 3): typing into each control fires the
// canonical AnswerValue shape for its question type. The emitted value is
// asserted with task 002's own parsers — reusing the canonical schemas as the
// oracle, not a re-implementation. A stateful host makes the controls genuinely
// controlled (values flow back down), proving the full loop.

const kitchen = loadGoldenForms().find((f) => f.version === "v2" && f.form === "kitchen-sink");
if (!kitchen) throw new Error("kitchen-sink v2 golden not found");
const stepById = (id: string): A2UIStepDocument => {
  const step = kitchen.compiled.documents.find((d) => d.stepId === id);
  if (!step) throw new Error(`step ${id} not found`);
  return step;
};
const stepAbout = stepById("stp_about");
const stepHealth = stepById("stp_health");
const stepCover = stepById("stp_cover");

// The one question type no golden document exercises: singleChoice with > 7
// options (Select). A tiny synthetic fixture — not a golden, just a test input.
const selectStep: A2UIStepDocument = {
  stepId: "stp_select",
  root: {
    type: "Form",
    children: [
      {
        type: "Flex",
        props: { direction: "column", gap: "md" },
        children: [
          { type: "Text", props: { as: "h2" }, children: "Where do you live?" },
          {
            type: "Select",
            props: {
              label: "Country",
              name: "q_country",
              isRequired: true,
              items: [
                { value: "opt_au", label: "Australia" },
                { value: "opt_nz", label: "New Zealand" },
                { value: "opt_us", label: "United States" },
                { value: "opt_ca", label: "Canada" },
                { value: "opt_gb", label: "United Kingdom" },
                { value: "opt_ie", label: "Ireland" },
                { value: "opt_de", label: "Germany" },
                { value: "opt_fr", label: "France" },
              ],
            },
          },
          {
            type: "Honeypot",
            props: { name: "website", autoComplete: "off", ariaHidden: true, tabIndex: -1 },
          },
        ],
      },
    ],
  },
};

describe("controlled value round-trip → canonical AnswerValue (task 002 schemas)", () => {
  it("shortText (TextField) emits an NFC string", async () => {
    const user = userEvent.setup();
    const changes = useChanges();
    render(<ControlledHost document={stepAbout} onChange={changes.onChange} />);
    await user.type(screen.getByRole("textbox", { name: /Full name/ }), "Ada Lovelace");
    expect(parseTextAnswerValue(changes.latest("q_full_name"))).toEqual({
      ok: true,
      value: "Ada Lovelace",
    });
  });

  it("date (DatePicker) emits an ISO YYYY-MM-DD string", async () => {
    const user = userEvent.setup();
    const changes = useChanges();
    render(<ControlledHost document={stepAbout} onChange={changes.onChange} />);
    const group = screen.getByRole("group", { name: /Date of birth/ });
    const segments = within(group).getAllByRole("spinbutton");
    await user.click(segments[0]);
    // en-US order MM/DD/YYYY; typing fills each segment and auto-advances.
    await user.keyboard("01151990");
    expect(parseDateAnswerValue(changes.latest("q_dob"))).toEqual({
      ok: true,
      value: "1990-01-15",
    });
  });

  it("boolean (RadioGroup) emits a JSON boolean", async () => {
    const user = userEvent.setup();
    const changes = useChanges();
    render(<ControlledHost document={stepHealth} onChange={changes.onChange} />);
    await user.click(screen.getByRole("radio", { name: "Yes" }));
    expect(parseBooleanAnswerValue(changes.latest("q_smoker"))).toEqual({ ok: true, value: true });
    await user.click(screen.getByRole("radio", { name: "No" }));
    expect(parseBooleanAnswerValue(changes.latest("q_smoker"))).toEqual({ ok: true, value: false });
  });

  it("number (NumberField) emits a finite number", async () => {
    const user = userEvent.setup();
    const changes = useChanges();
    render(<ControlledHost document={stepHealth} onChange={changes.onChange} />);
    const field = screen.getByRole("textbox", { name: /cigarettes/ });
    await user.type(field, "12");
    await user.tab();
    expect(parseNumberAnswerValue(changes.latest("q_cigs_daily"))).toEqual({ ok: true, value: 12 });
  });

  it("multiChoice (CheckboxGroup) emits a deduplicated OptionId[]", async () => {
    const user = userEvent.setup();
    const changes = useChanges();
    render(<ControlledHost document={stepHealth} onChange={changes.onChange} />);
    await user.click(screen.getByRole("checkbox", { name: "Diabetes" }));
    await user.click(screen.getByRole("checkbox", { name: "Asthma" }));
    expect(parseMultiChoiceAnswerValue(changes.latest("q_preexisting_conditions"))).toEqual({
      ok: true,
      value: ["opt_diabetes", "opt_asthma"],
    });
  });

  it("longText (TextArea) emits an NFC string", async () => {
    const user = userEvent.setup();
    const changes = useChanges();
    render(<ControlledHost document={stepHealth} onChange={changes.onChange} />);
    await user.type(
      screen.getByRole("textbox", { name: /Relevant medical history/ }),
      "Asthma since 2010",
    );
    expect(parseTextAnswerValue(changes.latest("q_medical_history"))).toEqual({
      ok: true,
      value: "Asthma since 2010",
    });
  });

  it("singleChoice ≤ 7 (RadioGroup) emits an OptionId", async () => {
    const user = userEvent.setup();
    const changes = useChanges();
    render(<ControlledHost document={stepCover} onChange={changes.onChange} />);
    await user.click(screen.getByRole("radio", { name: "Standard" }));
    expect(parseSingleChoiceAnswerValue(changes.latest("q_coverage_level"))).toEqual({
      ok: true,
      value: "opt_standard",
    });
  });

  it("singleChoice > 7 (Select) emits an OptionId", async () => {
    const user = userEvent.setup();
    const changes = useChanges();
    render(<ControlledHost document={selectStep} onChange={changes.onChange} />);
    await user.click(screen.getByRole("button", { name: /Country/ }));
    await user.click(screen.getByRole("option", { name: "New Zealand" }));
    expect(parseSingleChoiceAnswerValue(changes.latest("q_country"))).toEqual({
      ok: true,
      value: "opt_nz",
    });
  });
});
