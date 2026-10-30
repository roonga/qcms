import { describe, expect, it } from "vitest";

import { t } from "../i18n/en.ts";

import { contextChipKey, contextChipLabel } from "./context-chip.ts";
import { AGENT_SCREENS, screenForPath } from "./screens.ts";

/**
 * The context chip names what the agent can see on **this** screen (section 4.8).
 *
 * The property worth a test is that the lines are per screen rather than one generic
 * string: a chip that said the same thing on the response list and on Settings would tell
 * an operator nothing about what the next turn carries.
 */
describe("the context chip", () => {
  it("has a distinct line for every screen", () => {
    const lines = AGENT_SCREENS.map((screen) => t(contextChipKey(screen)));
    expect(new Set(lines).size).toBe(AGENT_SCREENS.length);
  });

  it("names the subject the screen knows, and the route id when it knows no name", () => {
    const builder = screenForPath("/forms/frm_quote");
    expect(contextChipLabel(builder, "Vehicle quote")).toBe("Form: Vehicle quote, draft");
    expect(contextChipLabel(builder)).toBe("Form: frm_quote, draft");
  });

  it("carries the version and the session id where the route has one", () => {
    expect(contextChipLabel(screenForPath("/forms/frm_quote/versions/3"))).toBe(
      "Form frm_quote: version 3",
    );
    expect(contextChipLabel(screenForPath("/forms/frm_quote/responses/ses_1"))).toBe(
      "Form frm_quote: session ses_1, metadata only",
    );
  });

  it("says the response screens carry no answers, which is the rule this phase spreads", () => {
    expect(contextChipLabel(screenForPath("/responses"))).toContain("no answers");
    expect(contextChipLabel(screenForPath("/forms/frm_quote/responses"))).toContain("no answers");
  });

  it("leaves no placeholder unfilled on any screen", () => {
    for (const screen of AGENT_SCREENS) {
      const resolved = screenForPath(
        screen
          .replaceAll("[formId]", "frm_1")
          .replaceAll("[questionId]", "q_1")
          .replaceAll("[workspaceId]", "wsp_1")
          .replaceAll("[sessionId]", "ses_1")
          .replaceAll("[version]", "2"),
      );
      expect(contextChipLabel(resolved)).not.toMatch(/\{\w+\}/u);
    }
  });

  it("says nothing of a path no screen serves", () => {
    expect(contextChipLabel(screenForPath("/forms/frm_1/export"))).toBe(t("agent.context.none"));
  });
});
