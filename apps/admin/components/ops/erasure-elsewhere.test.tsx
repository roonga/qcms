import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErasureElsewhereOffer } from "./erasure-elsewhere.tsx";
import { t } from "../../lib/i18n/en.ts";
import { ENVIRONMENT_COOKIE } from "../../lib/environment.ts";

/**
 * Q7's cross-environment erasure offer **offers and performs nothing** (task 067,
 * criterion 4).
 *
 * The criterion names its own failure mode: "an implementation that helpfully erases
 * everywhere on one confirmation fails the criterion and is not undoable". So the
 * assertions below are mostly negative, and the negatives are the point. Pressing the
 * control reaches **no erasure path at all** - the component is passed no action and
 * imports none - and what it does instead is the switcher's two steps, so that the screen
 * which then renders is the one carrying that environment's own type-to-confirm.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  refresh.mockClear();
  document.cookie = `${ENVIRONMENT_COOKIE}=prod; Path=/`;
});

describe("the cross-environment erasure offer", () => {
  it("renders nothing when the subject has sessions nowhere else", () => {
    // An empty list means "nothing more that you can do from here", and the screen says
    // it by saying nothing: a reassuring banner on every response would be a banner
    // nobody reads by the time it matters.
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
    // The sentence is the mitigation Q7 asks for: an operator who believed one act had
    // covered every environment would stop here, and the request would be half answered.
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
    // The switcher's two steps and no third: the cookie the server reads, then a re-read
    // of this route. The erasure in `test` is a separate act on the screen that follows,
    // with its own type-to-confirm naming its own environment.
    expect(document.cookie).toContain(`${ENVIRONMENT_COOKIE}=test`);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("offers an already-erased environment too, which is what an operator is working through", () => {
    // Not filtered out: "already done there" is the line that lets somebody answering a
    // data subject's request tell a finished environment from one they have not reached.
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
