import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { withNativeSubmit } from "./native-submit.ts";
import { loadGoldenForms } from "./test-support/golden.ts";

// Native (no-JS) submit mode (task 044). The opt-in `nativeSubmit` prop turns the
// SAME renderer into a natively-submittable form: a real <form method=post
// action> with uncontrolled, natively-serializing controls, a real submit
// control, and a hidden kind tag per answer so the strict BFF can decode the wire
// string. The default (controlled) render is byte-identical to 028/029 - proven
// here and by the untouched conformance snapshots.

const insurance = loadGoldenForms().find((f) => f.version === "v1" && f.form === "insurance");
if (!insurance) throw new Error("v1 insurance golden not found");
const insuranceStep = insurance.compiled.documents[0];

const minimalV2 = loadGoldenForms().find((f) => f.version === "v2" && f.form === "minimal");
if (!minimalV2) throw new Error("v2 minimal golden not found");
const minimalV2Step = minimalV2.compiled.documents[0];

const kitchenSink = loadGoldenForms().find((f) => f.version === "v1" && f.form === "kitchen-sink");
if (!kitchenSink) throw new Error("v1 kitchen-sink golden not found");
const kitchenSinkSteps = kitchenSink.compiled.documents;

// The kitchen sink's multiChoice, which is the control that serializes NOTHING when
// nothing is checked and so cannot be read off the posted values at all.
const MULTI_QUESTION = "q_preexisting_conditions";
const multiStep = kitchenSinkSteps[1]!;

const NATIVE = {
  action: "/s/ses_abc/step",
  submitLabel: "Submit",
  submitClassName: "qcms-primary",
} as const;

describe("native submit mode (task 044)", () => {
  it("renders a real <form method=post action> the browser POSTs without JS", () => {
    const { container } = render(
      <A2UIStepRenderer document={insuranceStep} nativeSubmit={NATIVE} />,
    );
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    expect(form!.getAttribute("action")).toBe("/s/ses_abc/step");
    expect(form!.getAttribute("method")).toBe("post");
  });

  it("renders a real submit control (type=submit) inside the form", () => {
    const { container } = render(
      <A2UIStepRenderer document={insuranceStep} nativeSubmit={NATIVE} />,
    );
    const submit = container.querySelector('button[type="submit"]');
    expect(submit).not.toBeNull();
    expect(submit!.textContent).toBe("Submit");
    expect(submit!.className).toBe("qcms-primary");
    // The submit control is inside the native form (so it POSTs it).
    expect(submit!.closest("form")).toBe(container.querySelector("form"));
  });

  it("serializes each control natively, keyed by questionId", () => {
    const { container } = render(
      <A2UIStepRenderer document={insuranceStep} nativeSubmit={NATIVE} />,
    );
    // The boolean RadioGroup renders real named radios that serialize no-JS.
    const radios = container.querySelectorAll<HTMLInputElement>(
      'input[type="radio"][name="q_at_fault_accident"]',
    );
    expect(radios.length).toBe(2);
    expect([...radios].map((r) => r.value).sort()).toEqual(["false", "true"]);
    // The NumberField's form value is carried by a name-keyed input.
    expect(container.querySelector('[name="q_accident_count"]')).not.toBeNull();
  });

  it("tags each answer field with its transport kind for the BFF decoder", () => {
    const { container } = render(
      <A2UIStepRenderer document={insuranceStep} nativeSubmit={NATIVE} />,
    );
    const radioKind = container.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="__qk__q_at_fault_accident"]',
    );
    expect(radioKind?.value).toBe("radio");
    const numberKind = container.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="__qk__q_accident_count"]',
    );
    expect(numberKind?.value).toBe("number");
  });

  it("preserves the 030 focus-target handle in native mode", () => {
    const { container } = render(
      <A2UIStepRenderer document={insuranceStep} nativeSubmit={NATIVE} />,
    );
    expect(container.querySelector('[data-qcms-field="q_at_fault_accident"]')).not.toBeNull();
    expect(container.querySelector('[data-qcms-field="q_accident_count"]')).not.toBeNull();
  });

  it("seeds controls from `values` as uncontrolled defaults (no controlled warnings)", () => {
    const { container } = render(
      <A2UIStepRenderer
        document={insuranceStep}
        nativeSubmit={NATIVE}
        values={{ q_at_fault_accident: true }}
      />,
    );
    const yes = container.querySelector<HTMLInputElement>(
      'input[type="radio"][name="q_at_fault_accident"][value="true"]',
    );
    expect(yes?.checked).toBe(true);
  });

  it("carries the honeypot decoy INSIDE the native form (so it POSTs too, 026)", () => {
    const { container } = render(
      <A2UIStepRenderer document={minimalV2Step} nativeSubmit={NATIVE} />,
    );
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    const honeypot = form!.querySelector('input[name="website"]');
    expect(honeypot).not.toBeNull();
    // Still AT-invisible (aria-hidden wrapper, tabindex -1) - unchanged from 026.
    expect(honeypot!.getAttribute("tabindex")).toBe("-1");
    expect(honeypot!.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("leaves the controlled default path unchanged (no form action, no submit, no markers)", () => {
    const { container } = render(
      <A2UIStepRenderer document={insuranceStep} values={{ q_at_fault_accident: true }} />,
    );
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    // The controlled root Form renders a <form> but carries no native action, and
    // the submit control / marker inputs exist ONLY in native mode. Rendered WITH an
    // answer, so the answered marker's own condition is met and its absence here is
    // the mode gate rather than an empty `values` (issue #127): the scripted path
    // never submits this form, so nothing about it may change.
    expect(form!.getAttribute("action")).toBeNull();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    expect(container.querySelector('input[name^="__qk__"]')).toBeNull();
    expect(container.querySelector('input[name^="__qa__"]')).toBeNull();
  });

  it("does not mutate the stored compiled document (ADR-18)", () => {
    const root: A2UIStepDocument["root"] = {
      type: "Form",
      children: [{ type: "Text", props: { as: "h1" }, children: "Hi" }],
    };
    const before = JSON.parse(JSON.stringify(root)) as unknown;
    const transformed = withNativeSubmit(root, NATIVE);
    // The input root is untouched; a NEW node carries the render-time additions.
    expect(root).toEqual(before);
    expect(root.props).toBeUndefined();
    expect(transformed).not.toBe(root);
    expect((transformed.props as { action?: string }).action).toBe("/s/ses_abc/step");
  });
});

/**
 * The answered marker (issue #127, Code Owner ruling 2026-09-02).
 *
 * A native form posts an emptied text box exactly as it posts a never-touched one,
 * and posts an all-unchecked checkbox group as nothing at all, so the strict BFF
 * could not tell a cleared answer from an unanswered question and left the stale
 * one standing. The renderer knows which questions hold an answer (it seeds their
 * controls from `values`), so it says so in a hidden `__qa__<questionId>` companion
 * and the BFF reads a marked-but-empty field as an ADR-33 retraction.
 *
 * What these cases pin is that the marker tracks ANSWEREDNESS and nothing else, and
 * that the two invariants the decoding rule rests on hold in the rendered DOM: an
 * unanswered question is never marked (or every no-JS submit would retract), and an
 * answered one always serializes a value (or every no-JS submit would retract it).
 */
describe("the answered marker (issue #127)", () => {
  const answered = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLInputElement>('input[name^="__qa__"]')].map(
      (el) => el.name,
    );

  it("marks only the questions that currently hold an answer", () => {
    const { container } = render(
      <A2UIStepRenderer
        document={insuranceStep}
        nativeSubmit={NATIVE}
        values={{ q_at_fault_accident: true }}
      />,
    );
    // Both questions are rendered and both carry a kind tag; only the answered one
    // carries the marker. That asymmetry IS the signal.
    expect(container.querySelectorAll('input[name^="__qk__"]')).toHaveLength(2);
    expect(answered(container)).toEqual(["__qa__q_at_fault_accident"]);
  });

  it("marks nothing on a step where nothing has been answered", () => {
    const { container } = render(
      <A2UIStepRenderer document={insuranceStep} nativeSubmit={NATIVE} />,
    );
    expect(answered(container)).toEqual([]);
  });

  it("marks a multiChoice that holds a selection, and not an empty one", () => {
    const withSelection = render(
      <A2UIStepRenderer
        document={multiStep}
        nativeSubmit={NATIVE}
        values={{ [MULTI_QUESTION]: ["opt_diabetes"] }}
      />,
    );
    expect(answered(withSelection.container)).toContain(`__qa__${MULTI_QUESTION}`);

    const empty = render(<A2UIStepRenderer document={multiStep} nativeSubmit={NATIVE} />);
    expect(answered(empty.container)).not.toContain(`__qa__${MULTI_QUESTION}`);
  });

  it("is invisible to a respondent and to assistive technology, and takes no tab stop", () => {
    const { container } = render(
      <A2UIStepRenderer
        document={insuranceStep}
        nativeSubmit={NATIVE}
        values={{ q_at_fault_accident: true }}
      />,
    );
    const marker = container.querySelector<HTMLInputElement>(
      'input[name="__qa__q_at_fault_accident"]',
    );
    expect(marker).not.toBeNull();
    // `type=hidden` is the whole of it: such an input has no box, is not focusable,
    // is not in the accessibility tree and so can carry no accessible name. Asserted
    // as the absence of anything that would give it one, rather than only the type,
    // because a later hand could keep the type and add a label.
    expect(marker!.type).toBe("hidden");
    expect(marker!.getAttribute("aria-label")).toBeNull();
    expect(marker!.getAttribute("aria-labelledby")).toBeNull();
    expect(marker!.getAttribute("tabindex")).toBeNull();
    expect(marker!.labels?.length ?? 0).toBe(0);
  });

  it("rides inside the native form, so it posts with the answers", () => {
    const { container } = render(
      <A2UIStepRenderer
        document={insuranceStep}
        nativeSubmit={NATIVE}
        values={{ q_at_fault_accident: true }}
      />,
    );
    const marker = container.querySelector('input[name="__qa__q_at_fault_accident"]');
    expect(marker!.closest("form")).toBe(container.querySelector("form"));
  });

  it("keeps every answered control serializing a value, so a marker cannot clear one by accident", () => {
    // The decoding rule is "marked and empty means cleared", so a control that is
    // answered but serializes NOTHING would retract itself on every no-JS submit.
    // Two controls are worth the check by name: the NumberField and the DatePicker
    // both carry their form value in a JS-synced hidden input rather than in the
    // control the respondent sees, which is what puts clearing them out of scope
    // here (issue #18, phase 4) and what makes their marker safe.
    const { container } = render(
      <A2UIStepRenderer
        document={kitchenSinkSteps[0]!}
        nativeSubmit={NATIVE}
        values={{ q_full_name: "Ada Lovelace", q_dob: "1990-05-17" }}
      />,
    );
    const posted = new FormData(container.querySelector("form")!);
    for (const name of answered(container)) {
      const question = name.slice("__qa__".length);
      expect(posted.getAll(question).filter((v) => v !== "")).not.toHaveLength(0);
    }
    expect(answered(container).sort()).toEqual(["__qa__q_dob", "__qa__q_full_name"]);

    const number = render(
      <A2UIStepRenderer
        document={insuranceStep}
        nativeSubmit={NATIVE}
        values={{ q_at_fault_accident: true, q_accident_count: 3 }}
      />,
    );
    const numberPosted = new FormData(number.container.querySelector("form")!);
    expect(numberPosted.get("q_accident_count")).toBe("3");
    expect(answered(number.container)).toContain("__qa__q_accident_count");
  });
});
