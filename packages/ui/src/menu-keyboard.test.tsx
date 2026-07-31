import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useState } from "react";

import {
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuSeparator,
  MenuTrigger,
  MenuTriggerButton,
} from "./kit.ts";

/**
 * The menu's keyboard walkthrough (task 032, `docs/COMPONENT_GUIDELINES.md` step 6).
 *
 * Two shapes are covered because the kit ships two doors onto the same machinery:
 * the vendored `Menu` from the pinned registry, and the primitives the admin topbar
 * composes when it needs a trigger the vendored component's props cannot express
 * (an icon glyph, an initials disc). Both go through react-aria's `MenuTrigger`, so
 * a regression in one is a regression in the other - which is exactly why the
 * contract is asserted at this layer rather than trusted per host.
 *
 * The contract the frozen design card documents, and the reason this file exists:
 * Enter, Space or Arrow Down opens; arrows navigate; Escape closes and returns
 * focus to the trigger. None of it is written by QCMS, and asserting it here is
 * what keeps the topbar from growing key handlers of its own.
 *
 * ## The menu's accessible name is its TRIGGER's name, not its `aria-label`
 *
 * Worth knowing before reading the queries below, because it looks like a bug the
 * first time. `MenuTrigger` puts `aria-labelledby="<trigger id>"` on the menu, and
 * `aria-labelledby` outranks `aria-label` in the name computation, so a menu that
 * carries `aria-label="Appearance"` still announces as "Appearance: Dark". That is
 * the APG pattern (a popup is named by the control that opened it) and it is react-
 * aria's call, not something a host can unset - a `useContextProps` merge keeps the
 * context value whenever the local prop is `undefined`. The `aria-label` stays on
 * the menu anyway, because it is what the design card specifies and it is what
 * would take over if the trigger's name ever went missing.
 *
 * Same 30s file budget as `keyboard.test.tsx`, for the same reason (issue #61): a
 * simulated key press is a full event sequence through react-aria in jsdom, so the
 * cost scales with the CPU share the runner gets, and the budget belongs to the
 * file rather than to whichever test happens to cross first under load.
 */

/** The topbar's shape: an icon-only trigger over a single-select radio menu. */
function AppearanceHarness() {
  const [mode, setMode] = useState("Dark");
  return (
    <MenuTrigger>
      <MenuTriggerButton aria-label={`Appearance: ${mode}`}>
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" />
      </MenuTriggerButton>
      <MenuPopover>
        <MenuList
          aria-label="Appearance"
          selectionMode="single"
          selectedKeys={[mode]}
          onSelectionChange={(keys) => {
            if (keys !== "all") setMode([...keys].map(String)[0] ?? mode);
          }}
        >
          <MenuItem id="Light">Light</MenuItem>
          <MenuItem id="Dark">Dark</MenuItem>
          <MenuItem id="High contrast">High contrast</MenuItem>
        </MenuList>
      </MenuPopover>
    </MenuTrigger>
  );
}

/** The account shape: a header outside the menu, a separator, two plain actions. */
function AccountHarness({ onAction }: { readonly onAction: (key: string) => void }) {
  return (
    <MenuTrigger>
      <MenuTriggerButton aria-label="Account menu for op@example.test">OP</MenuTriggerButton>
      <MenuPopover>
        <div role="presentation">
          <span>Signed in as</span>
          <span>op@example.test</span>
        </div>
        <MenuSeparator />
        <MenuList
          aria-label="Account"
          onAction={(key) => {
            onAction(String(key));
          }}
        >
          <MenuItem id="password">Change password</MenuItem>
          <MenuItem id="sign-out">Sign out</MenuItem>
        </MenuList>
      </MenuPopover>
    </MenuTrigger>
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
    // Single selection is what makes these radios rather than plain items, and the
    // checked one is what the card's check glyph and inset edge have to agree with.
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual(["Light", "Dark", "High contrast"]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);

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

    // Arrow up from Dark to Light and choose it: the trigger's accessible name is the
    // only place the mode is spelled out for a screen reader, so it follows the choice.
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
    // The "Signed in as" block is presentation, so it is not a stop in the menu, and
    // the separator is not one either.
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
