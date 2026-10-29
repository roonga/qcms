import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useState } from "react";

import { Menu } from "./kit.ts";

// A menu's accessible name is its trigger's name, not its `aria-label`, because `MenuTrigger` puts
// `aria-labelledby` on the menu and that outranks it. The `aria-label` stays as the fallback if the trigger's
// name goes missing.

function AppearanceHarness() {
  const [mode, setMode] = useState("Dark");
  return (
    <Menu
      triggerLabel={`Appearance: ${mode}`}
      trigger={<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" />}
      menuLabel="Appearance"
      selectionMode="single"
      selectedKeys={[mode]}
      onSelectionChange={(keys) => {
        setMode(keys[0] ?? mode);
      }}
      items={[
        // A rich label needs its own `textValue`, the visible text carrying a glyph.
        {
          id: "Light",
          textValue: "Light",
          label: (
            <>
              <span aria-hidden="true">{mode === "Light" ? MARK : ""}</span>Light
            </>
          ),
        },
        {
          id: "Dark",
          textValue: "Dark",
          label: (
            <>
              <span aria-hidden="true">{mode === "Dark" ? MARK : ""}</span>Dark
            </>
          ),
        },
        {
          id: "High contrast",
          textValue: "High contrast",
          label: (
            <>
              <span aria-hidden="true">{mode === "High contrast" ? MARK : ""}</span>High contrast
            </>
          ),
        },
      ]}
    />
  );
}

/** U+2713. */
const MARK = "\u2713";

function AccountHarness({ onAction }: { readonly onAction: (key: string) => void }) {
  return (
    <Menu
      triggerLabel="Account menu for op@example.test"
      trigger={<span aria-hidden="true">OP</span>}
      menuLabel="Account"
      header={
        <>
          <span>Signed in as</span>
          <span>op@example.test</span>
        </>
      }
      onAction={(key) => {
        onAction(key);
      }}
      items={[
        { id: "password", label: "Change password", href: "/settings#change-password" },
        { id: "sign-out", label: "Sign out" },
      ]}
    />
  );
}

// Focus restoration runs in a frame callback, so it is polled rather than read once.
async function expectFocusReturned(trigger: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(document.activeElement).toBe(trigger);
  });
}

describe("menu keyboard contract", { timeout: 30_000 }, () => {
  it("opens on Enter, navigates with arrows, and returns focus on Escape", async () => {
    const user = userEvent.setup();
    render(<AppearanceHarness />);

    const trigger = screen.getByRole("button", { name: "Appearance: Dark" });
    trigger.focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("menu", { name: "Appearance: Dark" })).toBeTruthy();
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    // Choosing a row must not rename it.
    expect(items.map((item) => item.textContent)).toEqual([
      "Light",
      `${MARK}Dark`,
      "High contrast",
    ]);
    expect(screen.getByRole("menuitemradio", { name: "Dark" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Light" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "High contrast" })).toBeTruthy();

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    await expectFocusReturned(trigger);
  });

  it("opens on Space and on Arrow Down, and a choice moves the checked row", async () => {
    const user = userEvent.setup();
    render(<AppearanceHarness />);

    const trigger = screen.getByRole("button", { name: "Appearance: Dark" });
    trigger.focus();
    await user.keyboard("{ }");
    expect(await screen.findByRole("menu")).toBeTruthy();
    await user.keyboard("{Escape}");
    await expectFocusReturned(trigger);

    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("menu")).toBeTruthy();

    // The trigger's name is the only place the mode is spelled out for a screen reader.
    await user.keyboard("{ArrowUp}{Enter}");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Appearance: Light" })).toBeTruthy();
    });
  });

  it("runs an account action from the keyboard and closes the menu", async () => {
    const user = userEvent.setup();
    const fired: string[] = [];
    render(
      <AccountHarness
        onAction={(key) => {
          fired.push(key);
        }}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Account menu for op@example.test" });
    trigger.focus();
    await user.keyboard("{Enter}");

    await screen.findByRole("menu");
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Change password",
      "Sign out",
    ]);

    await user.keyboard("{ArrowDown}{Enter}");
    expect(fired).toEqual(["sign-out"]);
    expect(screen.queryByRole("menu")).toBeNull();
    await expectFocusReturned(trigger);
  });

  it("the vendored Menu carries the same contract", async () => {
    const user = userEvent.setup();
    const fired: string[] = [];
    render(
      <Menu
        triggerLabel="Options"
        items={[
          { id: "one", label: "One" },
          { id: "two", label: "Two" },
        ]}
        onAction={(key) => {
          fired.push(key);
        }}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Options" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("menu");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(fired).toEqual(["two"]);
    await expectFocusReturned(trigger);
  });
});
