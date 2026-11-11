import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormAvailability } from "./form-availability.tsx";
import { t } from "../../lib/i18n/en.ts";

function setStatus(): Promise<never> {
  return Promise.reject(new Error("the control must not offer an act here"));
}

describe("the availability door on a form with no release in this environment", () => {
  it("offers neither verb, and says why", () => {
    render(
      <FormAvailability
        slug="intake"
        status="unreleased"
        setStatus={setStatus}
        environment="prod"
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("qcms-form-not-released").textContent).toBe(
      t("forms.lifecycle.notReleasedHere"),
    );
    expect(screen.queryByTestId("qcms-form-closed")).toBeNull();
  });

  it("offers the close verb once a version is released and open", () => {
    render(
      <FormAvailability slug="intake" status="open" setStatus={setStatus} environment="prod" />,
    );

    expect(
      screen.getByRole("button", { name: t("forms.lifecycle.close", { environment: "prod" }) }),
    ).toBeTruthy();
    expect(screen.queryByTestId("qcms-form-not-released")).toBeNull();
  });
});
