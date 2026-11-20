import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { heldRequests } from "@/lib/membership/approval-wording";
import type {
  ApprovalRequest,
  MembershipActionState,
  WorkspaceSettings,
} from "@/lib/membership/types";

import { WorkspaceSettingsPanel } from "./workspace-settings-panel";

const DONE: MembershipActionState = { status: "done", message: "ok" };
const NOW = new Date("2026-11-20T12:00:00.000Z");
const WORKSPACE = { name: "Clinical", slug: "clinical" };
const PEOPLE = new Map([
  ["usr_1", "grace@qcms.test"],
  ["usr_2", "sam@qcms.test"],
]);

const SWITCH = "Second approval in production";

function settings(overrides: Partial<WorkspaceSettings> = {}): WorkspaceSettings {
  return {
    workspaceId: "ws_1",
    requireSecondApprover: false,
    nobodyElseCouldApprove: false,
    missingApprover: { administrator: false, publisher: false },
    ...overrides,
  };
}

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    requestId: "apr_1",
    kind: "second-approval-off",
    target: "ws_1",
    payload: {},
    requestedBy: "usr_1",
    requestedAt: "2026-11-20T12:00:00.000Z",
    expiresAt: "2026-11-27T12:00:00.000Z",
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    ...overrides,
  };
}

interface Options {
  readonly settings?: WorkspaceSettings;
  readonly viewerId?: string;
  readonly held?: ApprovalRequest;
  readonly decided?: ApprovalRequest;
}

/* This project carries no jest-dom, so a disabled control is read off the element itself. */
function isOff(element: Element): boolean {
  return element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
}

function renderPanel(options: Options & { readonly saved?: MembershipActionState } = {}) {
  const calls = {
    rename: vi.fn(() => Promise.resolve(DONE)),
    save: vi.fn(() => Promise.resolve(options.saved ?? DONE)),
    decide: vi.fn(() => Promise.resolve(DONE)),
  };
  const panel = (next: Options) => (
    <WorkspaceSettingsPanel
      settings={next.settings ?? settings()}
      workspace={WORKSPACE}
      viewerId={next.viewerId ?? "usr_1"}
      people={PEOPLE}
      held={next.held === undefined ? undefined : heldRequests([next.held], NOW)[0]}
      decided={next.decided === undefined ? undefined : heldRequests([next.decided], NOW)[0]}
      rename={calls.rename}
      save={calls.save}
      decide={calls.decide}
    />
  );
  const { rerender } = render(panel(options));
  return { ...calls, rerender: (next: Options) => rerender(panel(next)) };
}

function switchBox(): HTMLInputElement {
  return screen.getByRole("checkbox", { name: SWITCH });
}

describe("the workspace settings screen", () => {
  it("renames the workspace and says the stored identifier does not change", async () => {
    const calls = renderPanel();
    const user = userEvent.setup();
    const field = screen.getByLabelText("Workspace name");
    expect(screen.getByText("Stored identifier clinical. It cannot change.")).toBeTruthy();
    await user.clear(field);
    await user.type(field, "Clinical trials");
    await user.click(screen.getByRole("button", { name: "Save the name" }));
    expect(calls.rename).toHaveBeenCalledWith("ws_1", "Clinical trials");
  });

  it("refuses an empty name without asking the API", async () => {
    const calls = renderPanel();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Workspace name"));
    await user.click(screen.getByRole("button", { name: "Save the name" }));
    expect(calls.rename).not.toHaveBeenCalled();
    expect(screen.getAllByText("Enter a name.").length).toBeGreaterThan(0);
  });

  it("says the rule cannot be turned on here, and leaves the switch alone", () => {
    renderPanel({
      settings: settings({
        nobodyElseCouldApprove: true,
        missingApprover: { administrator: true, publisher: false },
      }),
    });
    const refusal = screen.getByTestId("qcms-second-approval-refusal");
    expect(refusal.textContent).toContain("Second approval cannot be turned on here.");
    expect(refusal.textContent).toContain("No other Workspace administrator or Site administrator");
    expect(refusal.textContent).toContain("An unclaimed or disabled account does not count.");
    expect(isOff(screen.getByRole("checkbox", { name: SWITCH }))).toBe(true);
    expect(screen.queryByTestId("qcms-second-approval-warning")).toBeNull();
  });

  it("warns once the rule is on and nobody else could approve, naming the cause", () => {
    renderPanel({
      settings: settings({
        requireSecondApprover: true,
        nobodyElseCouldApprove: true,
        missingApprover: { administrator: true, publisher: false },
      }),
    });
    expect(screen.getByTestId("qcms-second-approval-warning").textContent).toBe(
      "Second approval is on and nobody else could approve.",
    );
    expect(screen.getByRole("link", { name: "Appoint a Workspace administrator" })).toBeTruthy();
    expect(screen.queryByTestId("qcms-second-approval-refusal")).toBeNull();
  });

  it("names the missing Publish forms holder when that is the cause", () => {
    renderPanel({
      settings: settings({
        requireSecondApprover: true,
        nobodyElseCouldApprove: true,
        missingApprover: { administrator: false, publisher: true },
      }),
    });
    const warning = screen.getByRole("alert");
    expect(warning.textContent).toContain("No other person with Publish forms in production");
    expect(
      screen.getByRole("link", { name: "Add somebody to an access group with Publish forms" }),
    ).toBeTruthy();
  });

  it("shows no warning while another approver exists", () => {
    renderPanel({ settings: settings({ requireSecondApprover: true }) });
    expect(screen.queryByTestId("qcms-second-approval-warning")).toBeNull();
    expect(screen.queryByTestId("qcms-second-approval-refusal")).toBeNull();
  });

  it("shows the requester their own switch-off as pending, with no way to approve it", () => {
    renderPanel({
      settings: settings({ requireSecondApprover: true }),
      viewerId: "usr_1",
      held: request(),
    });
    const held = screen.getByTestId("qcms-second-approval-held");
    expect(held.textContent).toContain("Needs an Approver");
    expect(held.textContent).toContain("Expires in 7 days.");
    expect(held.textContent).toContain("You asked for this, so somebody else decides it.");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(isOff(screen.getByRole("checkbox", { name: SWITCH }))).toBe(true);
    expect(isOff(screen.getByRole("button", { name: "Save settings" }))).toBe(true);
  });

  it("offers another administrator the decision on a held switch-off", async () => {
    const calls = renderPanel({
      settings: settings({ requireSecondApprover: true }),
      viewerId: "usr_2",
      held: request(),
    });
    const user = userEvent.setup();
    expect(screen.getByText("grace@qcms.test asked to turn Second approval off.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(calls.decide).toHaveBeenCalledWith("ws_1", "apr_1", "approve");
  });

  it("reads the last switch-off's ending while none is waiting", () => {
    renderPanel({
      settings: settings({ requireSecondApprover: true }),
      decided: request({ status: "lapsed", decidedBy: "usr_2" }),
    });
    expect(screen.getByTestId("qcms-second-approval-decided").textContent).toContain(
      "ended undecided",
    );
    expect(screen.queryByTestId("qcms-second-approval-held")).toBeNull();
  });

  it("saves the switch only once it differs from what is stored", async () => {
    const calls = renderPanel();
    const user = userEvent.setup();
    expect(isOff(screen.getByRole("button", { name: "Save settings" }))).toBe(true);
    await user.click(screen.getByText(SWITCH));
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(calls.save).toHaveBeenCalledWith("ws_1", { requireSecondApprover: true });
  });

  it("puts the switch back on after a held switch-off, and says so as information", async () => {
    renderPanel({
      settings: settings({ requireSecondApprover: true }),
      saved: { status: "held", message: "Nothing has changed yet." },
    });
    const user = userEvent.setup();
    await user.click(screen.getByText(SWITCH));
    expect(switchBox().checked).toBe(false);
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText("Nothing has changed yet.")).toBeTruthy();
    expect(switchBox().checked).toBe(true);
  });

  it("puts the switch back after a refused change", async () => {
    renderPanel({ saved: { status: "error", message: "The settings were not saved: 409" } });
    const user = userEvent.setup();
    await user.click(screen.getByText(SWITCH));
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText("The settings were not saved: 409")).toBeTruthy();
    expect(switchBox().checked).toBe(false);
  });

  it("shows the stored rule while a switch-off waits and once it is decided, with no reload", async () => {
    const calls = renderPanel({ settings: settings({ requireSecondApprover: true }) });
    const user = userEvent.setup();
    await user.click(screen.getByText(SWITCH));
    calls.rerender({ settings: settings({ requireSecondApprover: true }), held: request() });
    expect(switchBox().checked).toBe(true);
    calls.rerender({ settings: settings({ requireSecondApprover: true }) });
    expect(switchBox().checked).toBe(true);
    calls.rerender({ settings: settings({ requireSecondApprover: false }) });
    expect(switchBox().checked).toBe(false);
  });
});
