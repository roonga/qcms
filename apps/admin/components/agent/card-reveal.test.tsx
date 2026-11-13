import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initialCard, settleStep, startRun, type AgentCardView } from "@/lib/agent/plan-state";
import { mintedLinksCsv } from "@/lib/forms/links";
import type { AgentPlanStep, AgentProposal } from "@/lib/forms/assist-stream";
import type { MintedLink } from "@/lib/forms/types";
import { t, tPlural } from "@/lib/i18n/en";

import { ActionCard } from "./action-card";

const PROPOSED_AT = "2026-07-20T00:00:00.000Z";
const SETTLED_AT = "2026-07-20T00:01:00.000Z";

const MINT: AgentPlanStep = {
  kind: "link.mint",
  screen: "/operations/forms/[formId]/links",
  args: { formId: "frm_quote", count: 2, expiresAt: "2026-11-30", oneTime: true },
  environment: "test",
  handOff: false,
  local: false,
  card: {
    titleKey: "agent.card.link.mint.title",
    consequenceKeys: ["agent.card.link.mint.consequence"],
    headingControl: "links.mint",
  },
  resultAllowlist: ["count", "expiresAt", "environment"],
};

const PROPOSAL: AgentProposal = {
  proposalId: "prp_mint",
  token: "tok",
  steps: [MINT],
  proposedAt: PROPOSED_AT,
  expiresAt: "2026-07-20T00:10:00.000Z",
  formId: "frm_quote",
  currentEnvironment: "test",
};

function minted(count: number): readonly MintedLink[] {
  return Array.from({ length: count }, (_unused, index) => ({
    linkId: `lnk_${String(index)}`,
    environment: "test",
    url: `https://forms.example/test/l/token-${String(index)}`,
    expiresAt: "2026-11-30T23:59:59.000Z",
  }));
}

function cardWith(reveal: string | readonly MintedLink[]): AgentCardView {
  return settleStep(
    startRun(initialCard(PROPOSAL)),
    0,
    MINT,
    {
      outcome: "done",
      result: { count: 2, expiresAt: "2026-11-30T23:59:59.000Z", environment: "test" },
      revealed: reveal,
    },
    SETTLED_AT,
  );
}

function renderReveal(
  reveal: string | readonly MintedLink[],
  onDismissReveal?: (index: number) => void,
) {
  return render(
    <ActionCard
      proposal={PROPOSAL}
      card={cardWith(reveal)}
      onConfirm={() => undefined}
      onCancel={() => undefined}
      onStop={() => undefined}
      {...(onDismissReveal === undefined ? {} : { onDismissReveal })}
    />,
  );
}

function revealBlock(): HTMLElement {
  return screen.getByTestId("qcms-acard-reveal");
}

let restoreClipboard: (() => void) | undefined;

function stubClipboard(writeText: (value: string) => Promise<void>): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  restoreClipboard = () => {
    if (previous === undefined) {
      delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
    } else {
      Object.defineProperty(globalThis.navigator, "clipboard", previous);
    }
  };
}

afterEach(() => {
  restoreClipboard?.();
  restoreClipboard = undefined;
  vi.restoreAllMocks();
});

describe("the addresses one mint produced", () => {
  it("lists every one of them under a label that counts them", () => {
    renderReveal(minted(3));
    const block = revealBlock();
    const title = tPlural("agent.card.reveal.links.one", "agent.card.reveal.links.other", 3);
    const list = screen.getByTestId("qcms-acard-reveal-list");
    expect(within(block).getByText(title).id).toBe(list.getAttribute("aria-labelledby"));
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("code")?.textContent)).toEqual(
      minted(3).map((link) => link.url),
    );
    expect(within(block).getByText(t("agent.card.reveal.links.note"))).toBeTruthy();
  });

  it("holds a hundred of them in one bounded list, each with its own copy control", () => {
    renderReveal(minted(100));
    const list = screen.getByTestId("qcms-acard-reveal-list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(100);
    expect(within(list).getAllByRole("button")).toHaveLength(100);
    // The list itself is the scroll region, so the panel does not grow a second scrollbar.
    expect(list.className).toContain("qcms-acard__reveal-list");
    expect(list.tabIndex).toBe(0);
  });

  it("names each copy control by its position, never by the address it would copy", () => {
    renderReveal(minted(2));
    const buttons = within(screen.getByTestId("qcms-acard-reveal-list")).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      t("agent.card.reveal.copy", { number: 1 }),
      t("agent.card.reveal.copy", { number: 2 }),
    ]);
    for (const button of buttons) {
      expect(button.textContent ?? "").not.toContain("token-");
    }
  });

  it("copies one address and says so without naming it", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>(() => Promise.resolve());
    const user = userEvent.setup();
    stubClipboard(writeText);
    renderReveal(minted(2));

    await user.click(
      screen.getByRole("button", { name: t("agent.card.reveal.copy", { number: 2 }) }),
    );

    const note = await screen.findByTestId("qcms-acard-reveal-note");
    expect(writeText).toHaveBeenCalledWith("https://forms.example/test/l/token-1");
    expect(note.textContent).toBe(t("forms.links.copied"));
    expect(note.getAttribute("aria-live")).toBe("polite");
    expect(note.textContent).not.toContain("token-");
  });

  it("says the address could not be copied when the clipboard refuses", async () => {
    const user = userEvent.setup();
    stubClipboard(() => Promise.reject(new Error("write refused")));
    renderReveal(minted(1));

    await user.click(
      screen.getByRole("button", { name: t("agent.card.reveal.copy", { number: 1 }) }),
    );

    expect((await screen.findByTestId("qcms-acard-reveal-note")).textContent).toBe(
      t("forms.links.copyFailed"),
    );
  });

  it("downloads every address as the same CSV the screen writes", async () => {
    const links = minted(4);
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:minted";
    });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    renderReveal(links);
    await user.click(screen.getByRole("button", { name: t("agent.card.reveal.csv") }));

    expect(await blobs[0]?.text()).toBe(mintedLinksCsv(links));
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe("frm_quote-links.csv");
  });

  it("warns that hiding them is final, and reports the dismissal to its owner", async () => {
    const dismissed = vi.fn<(index: number) => void>();
    const user = userEvent.setup();
    renderReveal(minted(2), dismissed);

    expect(
      within(revealBlock()).getByText(t("agent.card.reveal.dismissHint.other", { count: 2 })),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: t("agent.card.reveal.dismiss") }));
    expect(dismissed).toHaveBeenCalledWith(0);
  });

  it("offers no dismissal where no owner can clear it", () => {
    renderReveal(minted(2));
    expect(screen.queryByRole("button", { name: t("agent.card.reveal.dismiss") })).toBeNull();
  });
});

describe("a single revealed secret", () => {
  it("keeps its own wording and gains the same dismissal", async () => {
    const dismissed = vi.fn<(index: number) => void>();
    const user = userEvent.setup();
    renderReveal("whsec_abc123", dismissed);

    const block = revealBlock();
    expect(within(block).getByText(t("agent.card.revealOnce"))).toBeTruthy();
    expect(within(block).getByText("whsec_abc123")).toBeTruthy();
    expect(screen.queryByTestId("qcms-acard-reveal-list")).toBeNull();
    expect(screen.queryByRole("button", { name: t("agent.card.reveal.csv") })).toBeNull();
    expect(
      within(block).getByText(t("agent.card.reveal.dismissHint.one", { count: 1 })),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: t("agent.card.reveal.dismiss") }));
    expect(dismissed).toHaveBeenCalledWith(0);
  });
});
