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

  it("leaves the controlled default path unchanged (no form action, no submit, no kind tags)", () => {
    const { container } = render(<A2UIStepRenderer document={insuranceStep} />);
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    // The controlled root Form renders a <form> but carries no native action, and
    // the submit control / kind tags exist ONLY in native mode.
    expect(form!.getAttribute("action")).toBeNull();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    expect(container.querySelector('input[name^="__qk__"]')).toBeNull();
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
