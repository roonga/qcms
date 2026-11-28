import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n/en";

import { DefinitionDetail } from "./definition-detail";

const DEFINITION = {
  questionId: "q_privacy_notice",
  type: "singleChoice",
  label: { en: "Our privacy notice" },
  help: { en: "Tick to confirm you have read it." },
  required: true,
  options: [{ optionId: "opt_read_privacy_notice", label: { en: "I have read the notice" } }],
};

describe("a question definition on a card", () => {
  it("names the question and its answers, and shows no id in the open", () => {
    render(<DefinitionDetail definition={DEFINITION} />);
    const body = screen.getByTestId("qcms-acard-definition").querySelector("dl");
    expect(body).not.toBeNull();
    expect(body?.textContent).toContain("I have read the notice");
    expect(body?.textContent).not.toContain("opt_read_privacy_notice");
    expect(body?.textContent).not.toContain("q_privacy_notice");
  });

  it("keeps the question id and every option id behind Identifiers", () => {
    render(<DefinitionDetail definition={DEFINITION} />);
    const ids = screen.getByTestId("qcms-acard-definition-ids");
    expect(within(ids).getByText(t("agent.card.ids"))).toBeTruthy();
    expect(ids.textContent).toContain("q_privacy_notice");
    expect(ids.textContent).toContain("opt_read_privacy_notice");
  });

  it("words the question type and the required flag rather than showing their wire values", () => {
    render(<DefinitionDetail definition={DEFINITION} />);
    const body = screen.getByTestId("qcms-acard-definition").querySelector("dl");
    expect(body?.textContent).toContain(t("questions.type.singleChoice"));
    expect(body?.textContent).not.toContain("singleChoice");
    expect(body?.textContent).toContain(t("agent.card.arg.yes"));
    expect(body?.textContent).not.toContain("true");
  });

  it("keeps a constraint's regular expression out of the card and names it instead", () => {
    render(
      <DefinitionDetail
        definition={{
          ...DEFINITION,
          type: "shortText",
          constraints: { pattern: "^[0-9]{4}$", required: true },
        }}
      />,
    );
    const body = screen.getByTestId("qcms-acard-definition").querySelector("dl");
    expect(body?.textContent).toContain(t("forms.assist.definition.patternSet"));
    expect(body?.textContent).not.toContain("^[0-9]{4}$");
  });

  it("writes one locale's text on its own, with no tag in front of it", () => {
    render(<DefinitionDetail definition={DEFINITION} />);
    const body = screen.getByTestId("qcms-acard-definition").querySelector("dl");
    expect(body?.textContent).toContain("Our privacy notice");
    expect(body?.textContent).not.toContain("en:");
  });

  it("tells two locales apart by the language's name rather than its tag", () => {
    render(
      <DefinitionDetail
        definition={{ ...DEFINITION, label: { en: "Our privacy notice", fr: "Notre avis" } }}
      />,
    );
    const body = screen.getByTestId("qcms-acard-definition").querySelector("dl");
    expect(body?.textContent).toContain("English: Our privacy notice");
    expect(body?.textContent).toContain("French: Notre avis");
  });
});
