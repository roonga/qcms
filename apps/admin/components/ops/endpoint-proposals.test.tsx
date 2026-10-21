import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EndpointProposals } from "./endpoint-proposals.tsx";
import type { EndpointProposal } from "../../lib/ops/types.ts";
import { t } from "../../lib/i18n/en.ts";
import { unexpected } from "../../lib/ops/unexpected.ts";

/**
 * The pending-change panel (ADR-41's release rule, Q30, Q51; task 070).
 *
 * The property worth a test here is the one the mechanism exists for: a proposed production
 * URL is **visible and not in force**, which means it must be rendered somewhere that is
 * not the endpoint table and labelled as waiting. An operator who read the proposed value
 * as the live one would have exactly the belief the two-person rule was built to prevent.
 *
 * The other half is the rejection path (issue #352's rule): the server action is a prop, so
 * a fake prop is the whole fake and the `.then` chain, the transition and the markup are
 * the real component. A rejected promise with no `.catch` sets no state, and the dialog
 * then sits there while the operator wonders whether a production endpoint just moved.
 */

const WAITING: EndpointProposal = {
  proposalId: "wep_waiting",
  webhookId: "whk_ab12cd34",
  environment: "prod",
  kind: "update",
  url: "https://new-consumer.example/hook",
  active: null,
  rotatesSecret: false,
  proposedBy: "au_alice",
  proposedAt: "2026-10-22T09:00:00.000Z",
  confirmedBy: null,
  confirmedAt: null,
  appliedAt: null,
};

/** The two-pool window: somebody confirmed and the endpoint write did not land. */
const UNAPPLIED: EndpointProposal = {
  ...WAITING,
  proposalId: "wep_unapplied",
  webhookId: "whk_ef56ab78",
  kind: "deactivate",
  url: null,
  confirmedBy: "au_bob",
  confirmedAt: "2026-10-22T09:05:00.000Z",
};

function idle(): Promise<{ status: "idle" }> {
  return Promise.resolve({ status: "idle" });
}

describe("the pending endpoint changes panel", () => {
  it("renders nothing at all when nothing is waiting", () => {
    // The ordinary case on every screen: the rule gates `prod` alone and is off by default
    // (Q13), so an empty state here would be a permanent block of text saying nothing has
    // happened.
    render(
      <EndpointProposals proposals={{ ok: true, data: [] }} confirm={idle} withdraw={idle} />,
    );
    expect(screen.queryByTestId("qcms-endpoint-proposals")).toBeNull();
  });

  it("renders nothing when the read failed, rather than claiming nothing is waiting", () => {
    // Issue 572's rule one screen along: "the read failed" and "nothing is pending" are
    // different answers, and the page's own alert is what says which.
    render(<EndpointProposals proposals={{ ok: false }} confirm={idle} withdraw={idle} />);
    expect(screen.queryByTestId("qcms-endpoint-proposals")).toBeNull();
  });

  it("shows the proposed URL as waiting, with the account that proposed it", () => {
    render(
      <EndpointProposals
        proposals={{ ok: true, data: [WAITING] }}
        confirm={idle}
        withdraw={idle}
      />,
    );

    const row = screen.getByTestId("qcms-proposal-table").querySelector("tbody tr");
    expect(row?.textContent).toContain("https://new-consumer.example/hook");
    // Two accounts, not two kinds of person: the row names the proposer so the operator
    // reading it can tell whether it is their own.
    expect(row?.textContent).toContain("au_alice");
    // And it says it is waiting. Without this the proposed URL beside an endpoint id reads
    // as the endpoint's URL, which is the one misreading this mechanism cannot afford.
    expect(row?.textContent).toContain(t("ops.proposals.state.waiting"));
  });

  it("distinguishes a confirmed change whose apply has not landed", () => {
    render(
      <EndpointProposals
        proposals={{ ok: true, data: [UNAPPLIED] }}
        confirm={idle}
        withdraw={idle}
      />,
    );
    const row = screen.getByTestId("qcms-proposal-table").querySelector("tbody tr");
    expect(row?.textContent).toContain(t("ops.proposals.state.unapplied"));
  });

  it("warns in the confirm dialog that a proposer cannot confirm their own change", () => {
    // The rule, said before the press. The API refuses it either way; what this stops is
    // the refusal being the first the operator hears of the rule.
    render(
      <EndpointProposals
        proposals={{ ok: true, data: [WAITING] }}
        confirm={idle}
        withdraw={idle}
      />,
    );
    expect(screen.getByTestId("qcms-endpoint-proposals").textContent).toContain(
      t("ops.proposals.intro"),
    );
  });

  it("names the environment in the confirm dialog and calls the action", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => Promise.resolve({ status: "done" as const }));
    render(
      <EndpointProposals
        proposals={{ ok: true, data: [WAITING] }}
        confirm={confirm}
        withdraw={idle}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("ops.proposals.confirm") }));
    const dialog = await screen.findByRole("alertdialog");
    // Q6's restatement: confirming one of these is what makes a production endpoint live,
    // and an act against the wrong environment is not undoable.
    expect(within(dialog).getByTestId("qcms-proposal-environment").textContent).toContain("prod");
    expect(dialog.textContent).toContain(t("ops.proposals.confirmWarning"));

    await user.click(within(dialog).getByRole("button", { name: t("ops.proposals.confirm") }));
    expect(confirm).toHaveBeenCalledWith("wep_waiting");
  });

  it("says a rejected confirmation failed rather than sitting silent", async () => {
    const user = userEvent.setup();
    render(
      <EndpointProposals
        proposals={{ ok: true, data: [WAITING] }}
        confirm={() => Promise.reject(new TypeError("fetch failed"))}
        withdraw={idle}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("ops.proposals.confirm") }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: t("ops.proposals.confirm") }));

    expect((await screen.findByTestId("qcms-proposal-status")).textContent).toContain(unexpected());
  });

  it("withdraws through its own action, with the dialog that says what it discards", async () => {
    const user = userEvent.setup();
    const withdraw = vi.fn(() => Promise.resolve({ status: "done" as const }));
    render(
      <EndpointProposals
        proposals={{ ok: true, data: [WAITING] }}
        confirm={idle}
        withdraw={withdraw}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("ops.proposals.withdraw") }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(
      t("ops.proposals.withdrawBody", { environment: "prod", url: WAITING.url ?? "" }),
    );
    // No confirm warning on this one: either account may withdraw, which is why there is
    // one Withdraw rather than a Reject beside a Cancel.
    expect(dialog.textContent).not.toContain(t("ops.proposals.confirmWarning"));

    await user.click(within(dialog).getByRole("button", { name: t("ops.proposals.withdraw") }));
    expect(withdraw).toHaveBeenCalledWith("wep_waiting");
  });
});
