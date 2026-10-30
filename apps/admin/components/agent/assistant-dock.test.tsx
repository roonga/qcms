import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssistantButtonSlot, AssistantPanelSlot } from "./assistant-dock";

/**
 * With the flag off the assistant is **absent, not hidden** (exit criterion 2).
 *
 * The layout's own mechanism is that `agentAuthoringEnabled()` decides whether the
 * provider is rendered at all, so the stance is testable at the slots: with no provider
 * above them, neither puts anything in the document. It is asserted here rather than in
 * Playwright because `playwright.config.ts` starts the admin with the flag on and one run
 * cannot hold both states.
 */
describe("the assistant slots with no provider, which is the flag-off layout", () => {
  it("put nothing in the document", () => {
    const { container } = render(
      <>
        <AssistantButtonSlot />
        <AssistantPanelSlot />
      </>,
    );
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("qcms-assistant-button")).toBeNull();
    expect(screen.queryByTestId("qcms-assistant-panel")).toBeNull();
  });
});
