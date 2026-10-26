import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import type { FormVersionSnapshot } from "../../lib/forms/types.ts";
import type { ReadState } from "../../lib/read-state.ts";
import { ReleaseVersionReview } from "./release-version-review.tsx";
import { ReleasePanel } from "./release-panel.tsx";
import { t } from "../../lib/i18n/en.ts";

vi.mock("@/components/forms/version-view", () => ({
  VersionView: ({ snapshot }: { snapshot: FormVersionSnapshot }) => (
    <p>Stored version {snapshot.version}</p>
  ),
}));

function snapshot(version: number): FormVersionSnapshot {
  return {
    formId: "frm_intake",
    version,
    publishedAt: "2026-10-26T00:00:00.000Z",
    compilerVersion: "1",
    a2uiSpecVersion: "1",
    semanticsVersion: "1",
    definition: {},
    documents: [],
  };
}

describe("reviewing a release candidate", () => {
  it("keeps production confirmation disabled until the selected snapshot has loaded", async () => {
    const user = userEvent.setup();
    let complete: ((value: ReadState<FormVersionSnapshot>) => void) | undefined;
    const read = vi.fn(
      () =>
        new Promise<ReadState<FormVersionSnapshot>>((resolve) => {
          complete = resolve;
        }),
    );
    render(
      <ReleasePanel
        releases={[]}
        versions={[2]}
        environments={["test", "prod"]}
        selectedEnvironment="prod"
        workflow={{
          enabled: true,
          environment: "prod",
          canEdit: false,
          canPublish: false,
          canRelease: true,
          eligibleVersions: [2],
          preferredVersion: 2,
          currentVersion: 1,
        }}
        twoPerson={{ required: false, viewer: "approver", authorOf: {} }}
        reviewVersion={read}
        release={() => Promise.resolve({ status: "idle" })}
      />,
    );
    await user.click(screen.getByRole("button", { name: t("forms.releases.action") }));
    const confirm = await screen.findByRole("button", { name: "Release v2 to prod" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    await act(async () => {
      await Promise.resolve(complete?.({ ok: true, data: snapshot(2) }));
    });
    await screen.findByText("Stored version 2");
    await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(false));
  });
  it("keeps the selected snapshot when an older request completes later", async () => {
    const pending = new Map<number, (value: ReadState<FormVersionSnapshot>) => void>();
    const read = vi.fn(
      (version: number) =>
        new Promise<ReadState<FormVersionSnapshot>>((resolve) => pending.set(version, resolve)),
    );
    const ready = vi.fn();
    const view = render(
      <ReleaseVersionReview version={1} read={read} defaultTheme="slate" onReady={ready} />,
    );
    view.rerender(
      <ReleaseVersionReview version={2} read={read} defaultTheme="slate" onReady={ready} />,
    );
    await act(async () => {
      await Promise.resolve(pending.get(2)?.({ ok: true, data: snapshot(2) }));
    });
    await screen.findByText("Stored version 2");
    await act(async () => {
      await Promise.resolve(pending.get(1)?.({ ok: true, data: snapshot(1) }));
    });
    expect(screen.queryByText("Stored version 1")).toBeNull();
    expect(ready).toHaveBeenCalledWith(2);
    expect(ready).not.toHaveBeenCalledWith(1);
  });

  it("refuses to mark a different returned version as reviewed", async () => {
    const ready = vi.fn();
    render(
      <ReleaseVersionReview
        version={2}
        read={() => Promise.resolve({ ok: true, data: snapshot(1) })}
        defaultTheme="slate"
        onReady={ready}
      />,
    );
    await screen.findByRole("alert");
    expect(screen.queryByText("Stored version 1")).toBeNull();
    expect(ready).not.toHaveBeenCalledWith(2);
  });

  it("handles an unavailable snapshot without authorizing confirmation", async () => {
    const ready = vi.fn();
    render(
      <ReleaseVersionReview
        version={2}
        read={() => Promise.reject(new Error("offline"))}
        defaultTheme="slate"
        onReady={ready}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("could not be loaded"),
    );
    expect(ready).not.toHaveBeenCalledWith(2);
  });
});
