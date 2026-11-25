import type { Appearance } from "@roonga/qcms-core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { appearanceFromTheme, shippedThemeKey } from "@/lib/forms/appearance-edit";
import { shippedThemeOptions } from "@/lib/server/appearance-options";

import { useSeededAppearance } from "./appearance-seed";

const PLUM = (() => {
  const found = shippedThemeOptions().find((theme) => theme.key === shippedThemeKey("plum"));
  if (found === undefined) throw new Error("Plum is not a shipped theme");
  return found;
})();

const STORED = appearanceFromTheme(PLUM, null);
const TURN_EDIT: Appearance = { ...STORED, corners: "sharp" };
const UNDONE: Appearance = { ...STORED, corners: "pill" };
const HELD: Appearance = { ...STORED, corners: "rounded" };

function Host({ stored }: { readonly stored: Appearance | null }) {
  const look = useSeededAppearance(stored);
  return (
    <>
      <p data-testid="shown">{look.appearance?.corners ?? "none"}</p>
      <button
        type="button"
        onClick={() => {
          look.preview(HELD);
        }}
      >
        hold a look
      </button>
      <button type="button" onClick={look.settle}>
        settle
      </button>
    </>
  );
}

function shown(): string {
  return screen.getByTestId("shown").textContent ?? "";
}

describe("the preview's seeded appearance", () => {
  it("follows the stored draft, so a turn's edit and its Undo need no reload", () => {
    const { rerender } = render(<Host stored={STORED} />);
    expect(shown()).toBe("subtle");
    rerender(<Host stored={TURN_EDIT} />);
    expect(shown()).toBe("sharp");
    rerender(<Host stored={UNDONE} />);
    expect(shown()).toBe("pill");
  });

  it("keeps a look the drawer is holding unsaved rather than replacing it", async () => {
    const { rerender } = render(<Host stored={STORED} />);
    await userEvent.click(screen.getByRole("button", { name: "hold a look" }));
    expect(shown()).toBe("rounded");
    rerender(<Host stored={TURN_EDIT} />);
    expect(shown()).toBe("rounded");
  });

  it("follows the stored draft again once the held look has been saved", async () => {
    const { rerender } = render(<Host stored={STORED} />);
    await userEvent.click(screen.getByRole("button", { name: "hold a look" }));
    rerender(<Host stored={TURN_EDIT} />);
    expect(shown()).toBe("rounded");

    await userEvent.click(screen.getByRole("button", { name: "settle" }));
    rerender(<Host stored={UNDONE} />);
    expect(shown()).toBe("pill");
  });

  it("follows a draft that has no appearance at all", () => {
    const { rerender } = render(<Host stored={null} />);
    expect(shown()).toBe("none");
    rerender(<Host stored={STORED} />);
    expect(shown()).toBe("subtle");
  });
});
