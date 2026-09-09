import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useState } from "react";

import { Menu } from "./kit.ts";

/**
 * The menu's keyboard walkthrough (task 032, `docs/COMPONENT_GUIDELINES.md` step 6).
 *
 * Three shapes are covered, and since issue #234 all three are the SAME component:
 * the vendored `Menu` from the pinned registry, wearing the trigger, header and item
 * slots upstream added for exactly these hosts. Until then the topbar composed
 * react-aria's popup primitives directly, because the registry component's props
 * could not express an icon glyph, an initials disc, a checked row carrying a mark or
 * a "Signed in as" header, and this file asserted the contract for both doors. There
 * is one door now, and the contract is asserted at this layer rather than trusted per
 * host because four admin surfaces open menus and none of them should own a key
 * handler.
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
    <Menu
      triggerLabel={`Appearance: ${mode}`}
      trigger={<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" />}
      menuLabel="Appearance"
      selectionMode="single"
      selectedKeys={[mode]}
      onSelectionChange={(keys) => {
        setMode(keys.map(String)[0] ?? mode);
      }}
      items={[
        // A rich label with its own `textValue`, which is the shape the appearance
        // control actually ships: a decorative check glyph beside the mode's name.
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
    // Single selection is what makes these radios rather than plain items, and the
    // checked one is what the card's check glyph and inset edge have to agree with.
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    // The glyph is decorative and the row's NAME is its `textValue`, which is the whole
    // reason a rich label needs one: the visible text carries the mark, the accessible
    // name does not, and choosing a row must not rename it.
    expect(items.map((item) => item.textContent)).toEqual([
      "Light",
      `${MARK}Dark`,
      "High contrast",
    ]);
    // The mark is `aria-hidden`, so the computed name excludes it: choosing a row moves
    // the glyph without renaming the row.
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
