import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SecureLinks } from "./secure-links.tsx";
import { IDLE_REVOKE } from "../../lib/forms/builder-state.ts";
import type { MintedLink, SecureLink } from "../../lib/forms/types.ts";
import { t } from "../../lib/i18n/en.ts";

/**
 * The environment is restated wherever a link is minted or listed (ADR-40 Q6, Q19, Q21,
 * task 066).
 *
 * Minting is a **distributing** action: the links leave the building, and which
 * environment they belong to decides where a respondent's answers land. Q6's rule is that
 * such an action restates the environment in its confirmation, and this is the screen it
 * matters most on - an operator who has been working in `test` all morning must not mint
 * production invitations because the banner was the only thing that said so.
 *
 * The server action is a prop, so what is faked is the prop and everything from the
 * dialog to the panel is the real component. The *authority* is not here at all: the
 * action reads the switcher's cookie on the server and the API requires the field, so a
 * wrong prop could only mislabel the screen, never misdirect the mint.
 */

const LINKS: readonly SecureLink[] = [
  {
    linkId: "lnk_t1",
    environment: "test",
    state: "active",
    oneTime: false,
    expiresAt: "2027-01-01T00:00:00.000Z",
    consumedAt: null,
    revokedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

function minted(environment: string): readonly MintedLink[] {
  return [
    {
      linkId: "lnk_t2",
      environment,
      url:
        environment === "prod"
          ? "https://forms.example.test/l/a.token"
          : `https://forms.example.test/${environment}/l/a.token`,
      expiresAt: "2027-01-01T23:59:59.999Z",
    },
  ];
}

function renderScreen(environment: string): void {
  render(
    <SecureLinks
      formId="frm_one"
      environment={environment}
      links={{ ok: true, data: LINKS }}
      canMint
      maxBatch={10}
      mint={() => Promise.resolve({ status: "minted" as const, links: minted(environment) })}
      revoke={() => Promise.resolve(IDLE_REVOKE)}
    />,
  );
}

describe("the mint dialog restates the environment (Q6, Q19)", () => {
  it("names it in the title, in the body and on the confirm button", async () => {
    const user = userEvent.setup();
    renderScreen("test");

    await user.click(screen.getByRole("button", { name: t("forms.links.mint") }));
    const dialog = await screen.findByRole("dialog");

    // The title is read once and the button is pressed, so both carry it. The body is
    // inside the modal because the page's banner is behind it.
    expect(
      within(dialog).getByRole("heading", {
        name: t("forms.links.mintTitle", { environment: "test" }),
      }),
    ).toBeTruthy();
    expect(within(dialog).getByTestId("qcms-mint-environment").textContent).toContain("test");
    expect(
      within(dialog).getByRole("button", {
        name: t("forms.links.confirmMint", { environment: "test" }),
      }),
    ).toBeTruthy();
  });

  it("restates what was minted, from the API's own answer", async () => {
    const user = userEvent.setup();
    renderScreen("test");

    await user.click(screen.getByRole("button", { name: t("forms.links.mint") }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("spinbutton", { name: /month/i }));
    await user.keyboard("01012027");
    await user.click(
      within(dialog).getByRole("button", {
        name: t("forms.links.confirmMint", { environment: "test" }),
      }),
    );

    const panel = await screen.findByTestId("qcms-minted-links");
    // The environment on the ROW, not the one the screen asked for: what is restated is
    // what the API wrote.
    expect(within(panel).getByTestId("qcms-minted-environment").textContent).toContain("test");
    // And the URL carries it as its first path segment, so the link is legible as
    // non-production before anybody clicks it (Q16, Q21).
    expect(within(panel).getByText(/\/test\/l\//)).toBeTruthy();
  });

  it("leaves a prod URL unprefixed, so a production link is unchanged (criterion 7)", async () => {
    const user = userEvent.setup();
    renderScreen("prod");

    await user.click(screen.getByRole("button", { name: t("forms.links.mint") }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("spinbutton", { name: /month/i }));
    await user.keyboard("01012027");
    await user.click(
      within(dialog).getByRole("button", {
        name: t("forms.links.confirmMint", { environment: "prod" }),
      }),
    );

    const panel = await screen.findByTestId("qcms-minted-links");
    const url = within(panel).getByText(/\/l\//).textContent ?? "";
    expect(new URL(url).pathname).toMatch(/^\/l\/[^/]+$/);
  });
});

describe("the listing says which environment it is of (task 066)", () => {
  it("states the scope above the table and tags each row", () => {
    renderScreen("test");

    expect(screen.getByTestId("qcms-links-scope").textContent).toContain("test");
    // A tag rather than a seventh column: the table family's drop rule (§2) is what
    // decided Minted drops at 390px, and a note plus a data attribute says the whole
    // thing without spending a column on it.
    expect(screen.getByTestId("qcms-links-table").querySelector("tbody tr")).toHaveProperty(
      "dataset.environment",
      "test",
    );
  });
});
