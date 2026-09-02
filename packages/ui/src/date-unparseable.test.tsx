import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { loadGoldenForms } from "./test-support/golden.ts";

/**
 * A stored value the date parser cannot read renders an EMPTY picker, never a
 * render-time exception (issue #549).
 *
 * The vendored `DatePicker` used to bind `value ? parseDate(value) : undefined`, and
 * `@internationalized/date`'s `parseDate` THROWS on anything that is not a valid ISO
 * day. So any caller binding a value it had not already validated got a crash where
 * it expected a validation problem: issue #521 was a whole-screen 500 on
 * `?from=nope`, not a malformed query forwarded to the API. The guard is upstream in
 * a2-react-aria (ADR-22 keeps this repo's copy byte-identical) and arrives here
 * through the `a2ra.json` pin.
 *
 * The adapter is what makes this reachable: it passes the parent's stored answer
 * straight through as a string, so the class of bad value this covers is "whatever
 * the host has in its `values` map", which is not something `@qcms/ui` validates.
 *
 * jsdom is the right layer (ADR-23): a throw during render is not layout-dependent.
 */

const kitchen = loadGoldenForms().find((f) => f.version === "v3" && f.form === "kitchen-sink");
if (!kitchen) throw new Error("kitchen-sink v3 golden not found");
const stepAbout = kitchen.compiled.documents.find((d) => d.stepId === "stp_about");
if (!stepAbout) throw new Error("stp_about not found");
const step: A2UIStepDocument = stepAbout;
const specVersion = kitchen.compiled.a2uiSpecVersion;

/**
 * Values a host could plausibly hold for a date question and that `parseDate`
 * rejects: a free-text leftover, a localized spelling, a datetime, an
 * out-of-range day, and the empty string.
 */
const UNPARSEABLE = ["nope", "17/05/1990", "1990-05-17T00:00:00Z", "1990-13-45", ""];

describe("an unparseable stored date renders unselected instead of throwing", () => {
  it.each(UNPARSEABLE)("survives %j as the stored answer", (stored) => {
    // A render-time throw in this component surfaces as a 500 on the whole screen,
    // so a thrown error is the failure being pinned, not a caught one.
    expect(() =>
      render(
        <A2UIStepRenderer
          document={step}
          specVersion={specVersion}
          values={{ q_dob: stored }}
          onChange={vi.fn()}
        />,
      ),
    ).not.toThrow();

    // Unselected, not partially filled: every editable segment shows its
    // placeholder, which is what "no answer" looks like to a respondent.
    expect(screen.getByRole("spinbutton", { name: /month/i }).textContent).toMatch(/mm/i);
    expect(screen.getByRole("spinbutton", { name: /day/i }).textContent).toMatch(/dd/i);
    expect(screen.getByRole("spinbutton", { name: /year/i }).textContent).toMatch(/yyyy/i);
  });

  it("still displays a valid stored date, so the guard did not swallow the good case", () => {
    render(
      <A2UIStepRenderer
        document={step}
        specVersion={specVersion}
        values={{ q_dob: "1990-05-17" }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("spinbutton", { name: /month/i }).textContent).toBe("5");
    expect(screen.getByRole("spinbutton", { name: /day/i }).textContent).toBe("17");
    expect(screen.getByRole("spinbutton", { name: /year/i }).textContent).toBe("1990");
  });
});
