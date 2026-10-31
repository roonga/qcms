import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { HeadingMarker } from "@/components/agent/heading-marker";
import { t } from "@/lib/i18n/en";

import {
  ProposalSeamProvider,
  useHandOff,
  useProposalSeam,
  type WaitingProposal,
} from "./waiting";

/**
 * The seam between the panel and the heading rows. What it carries is a control: a marker
 * that ran something, or a hand-off that sent a secret anywhere, would each be a security
 * failure rather than a visual one.
 */

function Publisher({ waiting }: { readonly waiting: WaitingProposal | undefined }) {
  const seam = useProposalSeam();
  const publish = seam?.publish;
  useEffect(() => {
    publish?.(waiting);
  }, [publish, waiting]);
  return null;
}

function HandOffHost({ onOpen }: { readonly onOpen: (fields: unknown) => void }) {
  const binding = useHandOff("settings.password");
  useEffect(() => {
    if (binding === undefined) return;
    onOpen(binding.fields);
  }, [binding, onOpen]);
  return null;
}

function Requester() {
  const seam = useProposalSeam();
  return (
    <button
      type="button"
      onClick={() => seam?.requestHandOff("settings.password", { email: "ops@qcms.test" })}
    >
      hand off
    </button>
  );
}

const WAITING: WaitingProposal = {
  cardId: "card-1",
  summary: "Release version 3 of frm_quote to prod",
  control: "releases.release",
};

function Host({ waiting }: { readonly waiting: WaitingProposal | undefined }) {
  const onPress = vi.fn();
  return (
    <ProposalSeamProvider onReview={onPress}>
      <Publisher waiting={waiting} />
      <HeadingMarker control="releases.release">
        <button type="button">Release a version</button>
      </HeadingMarker>
      <HeadingMarker control="links.mint">
        <button type="button">Mint links</button>
      </HeadingMarker>
    </ProposalSeamProvider>
  );
}

describe("the proposal seam", () => {
  it("marks the mirrored control and no other", () => {
    render(<Host waiting={WAITING} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Release a version" }).dataset["proposed"],
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Mint links" }).dataset["proposed"]).toBe(
      undefined,
    );
  });

  it("shows no marker once nothing waits", () => {
    render(<Host waiting={undefined} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows no marker for a step that mirrors no control", () => {
    render(<Host waiting={{ cardId: "card-1", summary: "Revoke one link" }} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("opens the panel and sends nothing when the marker is activated", async () => {
    const user = userEvent.setup();
    const onReview = vi.fn();
    render(
      <ProposalSeamProvider onReview={onReview}>
        <Publisher waiting={WAITING} />
        <HeadingMarker control="releases.release">
          <button type="button">Release a version</button>
        </HeadingMarker>
      </ProposalSeamProvider>,
    );
    await user.click(screen.getByRole("link"));
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link").getAttribute("href")).toBe("#card-1");
    // The words, not colour alone.
    expect(screen.getByRole("link").textContent).toContain(t("agent.marker.text"));
  });

  it("hands one control the non-secret fields, and clears when it is done", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <ProposalSeamProvider onReview={vi.fn()}>
        <Requester />
        <HandOffHost onOpen={onOpen} />
      </ProposalSeamProvider>,
    );
    expect(onOpen).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "hand off" }));
    expect(onOpen).toHaveBeenCalledWith({ email: "ops@qcms.test" });
  });
});
