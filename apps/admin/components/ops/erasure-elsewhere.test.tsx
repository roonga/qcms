import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErasureElsewhereOffer } from "./erasure-elsewhere.tsx";
import { t } from "../../lib/i18n/en.ts";
import { ENVIRONMENT_COOKIE } from "../../lib/environment.ts";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  refresh.mockClear();
  document.cookie = `${ENVIRONMENT_COOKIE}=prod; Path=/`;
});

describe("the cross-environment erasure offer", () => {
  it("renders nothing when the subject has sessions nowhere else", () => {
    const { container } = render(<ErasureElsewhereOffer others={[]} secureCookies={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("names each other environment and whether it has been erased there", () => {
    render(
      <ErasureElsewhereOffer
        others={[
          { environment: "test", alreadyErased: false },
          { environment: "staging", alreadyErased: true },
        ]}
        secureCookies={false}
      />,
    );
    expect(screen.getByText(t("ops.erase.elsewhere.title"))).toBeTruthy();
    expect(
      screen.getByText(t("ops.erase.elsewhere.pending", { environment: "test" })),
    ).toBeTruthy();
    expect(
      screen.getByText(t("ops.erase.elsewhere.done", { environment: "staging" })),
    ).toBeTruthy();
  });

  it("says that nothing here has been erased anywhere else", () => {
    render(
      <ErasureElsewhereOffer
        others={[{ environment: "test", alreadyErased: false }]}
        secureCookies={false}
      />,
    );
    expect(screen.getByText(t("ops.erase.elsewhere.body"))).toBeTruthy();
  });

  it("switches the environment and re-reads the page, and erases nothing", async () => {
    render(
      <ErasureElsewhereOffer
        others={[{ environment: "test", alreadyErased: false }]}
        secureCookies={false}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: t("ops.erase.elsewhere.go", { environment: "test" }) }),
    );
    expect(document.cookie).toContain(`${ENVIRONMENT_COOKIE}=test`);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("offers an already-erased environment too, which is what an operator is working through", () => {
    render(
      <ErasureElsewhereOffer
        others={[{ environment: "test", alreadyErased: true }]}
        secureCookies={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: t("ops.erase.elsewhere.go", { environment: "test" }) }),
    ).toBeTruthy();
  });
});
