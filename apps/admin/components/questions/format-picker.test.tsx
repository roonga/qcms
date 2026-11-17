import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "@/lib/i18n/en";
import { IDLE_MUTATION, type MutationState } from "@/lib/questions/editor-state";
import type { QuestionDefinitionView } from "@/lib/questions/types";

import { QuestionEditor } from "./question-editor";

const BLANK_SHORT_TEXT = {
  questionId: "q_contact_email",
  type: "shortText",
  label: { en: "Email address" },
  required: true,
  constraints: {},
} as unknown as QuestionDefinitionView;

function idle() {
  return vi.fn<(state: MutationState, formData: FormData) => Promise<MutationState>>(() =>
    Promise.resolve(IDLE_MUTATION),
  );
}

function editor(isFrozen = false) {
  return render(
    <QuestionEditor
      mode="edit"
      action={idle()}
      initialSlug="contact-email"
      initialDefinition={BLANK_SHORT_TEXT}
      version={1}
      isFrozen={isFrozen}
    />,
  );
}

async function choose(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
  await user.click(
    screen.getByRole("button", { name: new RegExp(`${t("questions.constraint.format")}$`, "u") }),
  );
  await user.click(screen.getByRole("option", { name: label }));
}

function patternField(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox", {
    name: t("questions.constraint.pattern"),
  });
}

function definitionPayload(): QuestionDefinitionView {
  const field = document.querySelector<HTMLInputElement>('input[name="definition"]');
  return JSON.parse(field?.value ?? "{}") as QuestionDefinitionView;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/questions/q_contact_email");
});

describe("the constraints panel's checked formats", { timeout: 30_000 }, () => {
  it("writes the pattern and its message together, and says where the message went", async () => {
    const user = userEvent.setup();
    editor();

    await choose(user, t("questions.format.email"));
    expect(screen.getByText("Accepts values like name@example.com.")).toBeTruthy();
    expect(patternField().value).toBe("");

    await user.click(screen.getByRole("button", { name: t("questions.constraint.formatApply") }));

    expect(patternField().value).toBe(String.raw`^[^@\s]+@[^@\s]+\.[^@\s]{2,}$`);
    expect(
      screen.getByRole("textbox", { name: t("questions.message.label.pattern") }),
    ).toHaveProperty("value", "Enter an email address, like name@example.com.");
    expect(screen.getByTestId("qcms-format-applied").textContent).toContain(
      t("questions.format.email"),
    );
  });

  it("sends both the pattern and the message with the definition", async () => {
    const user = userEvent.setup();
    editor();

    await choose(user, t("questions.format.postcode-au"));
    await user.click(screen.getByRole("button", { name: t("questions.constraint.formatApply") }));

    const payload = definitionPayload();
    expect(payload.constraints?.pattern).toBe(String.raw`^\d{4}$`);
    expect(payload.messages?.pattern).toEqual({ en: "An Australian postcode is four digits." });
  });

  it("leaves the pattern alone until the format is applied", async () => {
    const user = userEvent.setup();
    editor();

    await user.type(patternField(), "^abc$");
    await choose(user, t("questions.format.phone"));

    expect(patternField().value).toBe("^abc$");
    expect(definitionPayload().constraints?.pattern).toBe("^abc$");
  });

  it("offers nothing on a frozen version, which cannot be edited anyway", () => {
    editor(true);

    expect(
      screen.queryByRole("button", { name: t("questions.constraint.formatApply") }),
    ).toBeNull();
  });
});
