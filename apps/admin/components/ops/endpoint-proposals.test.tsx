import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EndpointProposals } from "./endpoint-proposals.tsx";
import type { EndpointProposal } from "../../lib/ops/types.ts";
import { t } from "../../lib/i18n/en.ts";
import { unexpected } from "../../lib/ops/unexpected.ts";

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
    render(<EndpointProposals proposals={{ ok: true, data: [] }} confirm={idle} withdraw={idle} />);
    expect(screen.queryByTestId("qcms-endpoint-proposals")).toBeNull();
  });

  it("renders nothing when the read failed, rather than claiming nothing is waiting", () => {
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
    expect(row?.textContent).toContain("au_alice");
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
    expect(dialog.textContent).not.toContain(t("ops.proposals.confirmWarning"));

    await user.click(within(dialog).getByRole("button", { name: t("ops.proposals.withdraw") }));
    expect(withdraw).toHaveBeenCalledWith("wep_waiting");
  });

  it("says per kind what confirming will do (review finding 4)", async () => {
    const cases = [
      [
        WAITING,
        t("ops.proposals.confirmBody.retarget", { environment: "prod", url: WAITING.url ?? "" }),
      ],
      [
        { ...WAITING, kind: "create" as const },
        t("ops.proposals.confirmBody.create", { environment: "prod", url: WAITING.url ?? "" }),
      ],
      [
        { ...WAITING, kind: "deactivate" as const, url: null },
        t("ops.proposals.confirmBody.deactivate", { environment: "prod" }),
      ],
      [
        { ...WAITING, url: null, rotatesSecret: true },
        t("ops.proposals.confirmBody.update", { environment: "prod" }),
      ],
    ] as const;

    for (const [proposal, sentence] of cases) {
      const user = userEvent.setup();
      const view = render(
        <EndpointProposals
          proposals={{ ok: true, data: [proposal] }}
          confirm={idle}
          withdraw={idle}
        />,
      );
      await user.click(screen.getByRole("button", { name: t("ops.proposals.confirm") }));
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog.textContent, `${proposal.kind}, url ${String(proposal.url)}`).toContain(
        sentence,
      );
      if (proposal.kind === "deactivate") {
        expect(dialog.textContent).toContain("stops receiving deliveries");
      }
      view.unmount();
    }
  });

  it("offers a confirmed-but-unapplied row a withdrawal, and says what it buys (review finding 3)", async () => {
    const user = userEvent.setup();
    const withdraw = vi.fn(() => Promise.resolve({ status: "done" as const }));
    render(
      <EndpointProposals
        proposals={{ ok: true, data: [UNAPPLIED] }}
        confirm={idle}
        withdraw={withdraw}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("ops.proposals.withdraw") }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(
      t("ops.proposals.withdrawBodyConfirmed", { environment: "prod" }),
    );
    await user.click(within(dialog).getByRole("button", { name: t("ops.proposals.withdraw") }));
    expect(withdraw).toHaveBeenCalledWith("wep_unapplied");
  });
});
