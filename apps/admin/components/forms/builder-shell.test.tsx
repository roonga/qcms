import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONVERSATION_STORAGE_KEY, builderConversationKey } from "../../lib/agent/conversation-state.ts";
import { builderSubjectName } from "../../lib/shell/builder-subject.ts";

import { BuilderShell } from "./builder-shell.tsx";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/forms/frm_a/build",
  useRouter: () => ({
    push: vi.fn(),
    refresh: () => {
      refresh();
    },
  }),
}));

const original = window.matchMedia;

function viewport(narrow: boolean): void {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: narrow,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

beforeEach(() => {
  viewport(false);
  refresh.mockReset();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  window.matchMedia = original;
  vi.restoreAllMocks();
});

function shell(props: Partial<Parameters<typeof BuilderShell>[0]> = {}) {
  return (
    <BuilderShell
      formId="frm_a"
      name="Patient intake"
      userId="usr_1"
      workspaceId="ws_a"
      canPublish
      {...props}
    />
  );
}

describe("the builder's heading row", () => {
  it("holds Edit by hand, Share preview and Publish, each named by what it shows", () => {
    render(shell());
    expect(screen.getByRole("link", { name: "Edit by hand" }).getAttribute("href")).toBe(
      "/forms/frm_a",
    );
    expect(screen.getByRole("link", { name: "Share preview" }).getAttribute("href")).toBe(
      "/forms/frm_a/preview",
    );
    expect(screen.getByRole("link", { name: "Publish" }).getAttribute("href")).toBe(
      "/forms/frm_a/publish?returnTo=%2Fforms%2Ffrm_a%2Fbuild",
    );
  });

  it("offers Publish to a Publish forms holder only", () => {
    render(shell({ canPublish: false }));
    expect(screen.queryByRole("link", { name: "Publish" })).toBeNull();
    expect(screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);
  });

  it("keeps every action off until a new form exists", () => {
    render(shell({ formId: null, name: "New form", canPublish: false }));
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    for (const name of ["Edit by hand", "Share preview", "Publish"]) {
      expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
    }
  });

  it("names the form for the top bar group while it is on screen", () => {
    const view = render(shell());
    expect(builderSubjectName()).toBe("Patient intake");
    view.unmount();
    expect(builderSubjectName()).toBe("");
  });
});

describe("the two panes", () => {
  it("sit side by side at 64rem and above, with no tabs", () => {
    render(shell());
    expect(screen.getByRole("region", { name: "Assistant" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Preview" })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("become two tabs below 64rem, the assistant first", async () => {
    viewport(true);
    const user = userEvent.setup();
    render(shell());
    const tabs = screen.getByRole("tablist", { name: "Builder panes" });
    expect(tabs).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Assistant" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByTestId("qcms-builder-assistant")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByRole("tab", { name: "Preview" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("qcms-builder-preview")).toBeTruthy();
  });
});

describe("the builder's conversation store", () => {
  it("lives in this tab under its own key, never the dock's, and never reaches the server", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    render(shell());
    const key = builderConversationKey("usr_1", "ws_a", "frm_a");
    await waitFor(() => {
      expect(window.sessionStorage.getItem(key)).not.toBeNull();
    });
    expect(window.sessionStorage.getItem(CONVERSATION_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.length).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("a form with no open draft", () => {
  it("offers Start a new draft before any pane, then reloads onto the draft", async () => {
    const user = userEvent.setup();
    const start = vi.fn(() => Promise.resolve({ status: "started" as const }));
    render(shell({ startDraft: start }));
    expect(screen.queryByRole("region", { name: "Assistant" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Start a new draft" }));
    expect(start).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("says why when the draft was not started", async () => {
    const user = userEvent.setup();
    render(
      shell({
        startDraft: () => Promise.resolve({ status: "error" as const, message: "Refused." }),
      }),
    );
    await user.click(screen.getByRole("button", { name: "Start a new draft" }));
    expect(await screen.findByText("The draft was not started. Refused.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
