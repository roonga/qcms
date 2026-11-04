import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssistantButtonSlot, AssistantPanelSlot } from "./assistant-dock";

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
