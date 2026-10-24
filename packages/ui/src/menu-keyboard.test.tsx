import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useState } from "react";

import { Menu } from "./kit.ts";

/**
 * The menu's keyboard walkthrough (`docs/COMPONENT_GUIDELINES.md` step 6).
 *
 * The contract is Enter, Space or Arrow Down opens, arrows navigate, Escape closes
 * and returns focus to the trigger. None of it is written by QCMS, and asserting it
 * at this layer rather than per host is what keeps four admin surfaces from growing
 * key handlers of their own.
 *
 * Worth knowing before reading the queries below, because it looks like a bug the
 * first time: a menu's accessible name is its trigger's name, not its `aria-label`.
 * `MenuTrigger` puts `aria-labelledby` on the menu and that outranks `aria-label` in
 * the name computation. It is the APG pattern, a popup is named by the control that
 * opened it, and react-aria's call rather than something a host can unset. The
 * `aria-label` stays anyway, as what would take over if the trigger's name went
 * missing.
 *
 * Same file budget as `keyboard.test.tsx` and for the same reason: a simulated key
 * press is a full event sequence through react-aria in jsdom, so the cost scales with
 * the CPU share the runner gets.
 */

/** The topbar's shape: an icon-only trigger over a single-select radio menu. */
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
        // A rich label with its own `textValue`, the shape the appearance control
        // ships: a decorative check glyph beside the mode's name.
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

/** The check glyph the appearance rows carry. U+2713. */
const MARK = "\u2713";

/** The account shape: a header outside the menu, a rule, a link row and an action row. */
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

/** Focus restoration runs in a frame callback, so it is polled rather than read once. */
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
    // Single selection is what makes these radios rather than plain items.
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    // The glyph is decorative and the row's name is its `textValue`, which is why a
    // rich label needs one: choosing a row must not rename it.
    expect(items.map((item) => item.textContent)).toEqual([
      "Light",
      `${MARK}Dark`,
      "High contrast",
    ]);
    // The mark is `aria-hidden`, so choosing a row moves the glyph without renaming it.
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

    // The trigger's accessible name is the only place the mode is spelled out for a
    // screen reader, so it has to follow the choice.
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
    // The header block and the separator are presentation, so neither is a stop.
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Change password",
      "Sign out",
    ]);

    // Opening focuses the first item, so one Arrow Down lands on Sign out.
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
