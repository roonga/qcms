import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { loadGoldenForms } from "./test-support/golden.ts";

/**
 * A stored value the date parser cannot read renders an empty picker, never a
 * render-time exception.
 *
 * `@internationalized/date`'s `parseDate` throws on anything that is not a valid ISO
 * day, so a caller binding an unvalidated value got a whole-screen crash where it
 * expected a validation problem. The guard is upstream in a2-react-aria and arrives
 * here through the pin (ADR-22 keeps this repo's copy byte-identical).
 *
 * The adapter is what makes it reachable, because it passes the parent's stored
 * answer straight through as a string and `@roonga/qcms-ui` validates none of it.
 */

const kitchen = loadGoldenForms().find((f) => f.version === "v3" && f.form === "kitchen-sink");
if (!kitchen) throw new Error("kitchen-sink v3 golden not found");
const stepAbout = kitchen.compiled.documents.find((d) => d.stepId === "stp_about");
if (!stepAbout) throw new Error("stp_about not found");
const step: A2UIStepDocument = stepAbout;
const specVersion = kitchen.compiled.a2uiSpecVersion;

/** Values a host could plausibly hold for a date question and `parseDate` rejects. */
const UNPARSEABLE = ["nope", "17/05/1990", "1990-05-17T00:00:00Z", "1990-13-45", ""];

describe("an unparseable stored date renders unselected instead of throwing", () => {
  it.each(UNPARSEABLE)("survives %j as the stored answer", (stored) => {
    // A render-time throw here surfaces as a 500 on the whole screen, so the throw is
    // the failure being pinned rather than a caught error.
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

    // Unselected rather than partially filled: every segment shows its placeholder.
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
