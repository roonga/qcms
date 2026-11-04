import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreateForm } from "@/app/(shell)/forms/new/create-form";
import { IDLE_CREATE_FORM, type CreateFormState } from "@/lib/forms/builder-state";
import { IDLE_MUTATION, type MutationState } from "@/lib/questions/editor-state";
import type { QuestionDefinitionView } from "@/lib/questions/types";

import { QuestionEditor } from "./questions/question-editor";

const DEFINITION = {
  questionId: "q_passport",
  type: "shortText",
  label: { en: "Passport number" },
  required: true,
} as unknown as QuestionDefinitionView;

function neverCalledCreateAction(): Promise<CreateFormState> {
  return Promise.resolve(IDLE_CREATE_FORM);
}

function neverCalledMutation(): Promise<MutationState> {
  return Promise.resolve(IDLE_MUTATION);
}

const CREATE_SUBMIT_NAME = "Create form";

let container: HTMLElement | undefined;

afterEach(() => {
  container?.remove();
  container = undefined;
  vi.restoreAllMocks();
});

function serveAndFind(element: React.ReactElement, selector: string): HTMLButtonElement {
  const html = renderToString(element);
  container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  const button = container.querySelector<HTMLButtonElement>(selector);
  expect(button, `the served bytes must contain ${selector}`).not.toBeNull();
  return button as HTMLButtonElement;
}

describe("a Server Action submit before hydration (issue #1032)", () => {
  it("renders the create-form submit disabled in the served bytes", () => {
    const button = serveAndFind(
      <CreateForm action={neverCalledCreateAction} />,
      'button[type="submit"]',
    );

    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-disabled")).toBeNull();
    expect(button.textContent?.trim()).toBe(CREATE_SUBMIT_NAME);
    const form = container?.querySelector("form");
    expect(form).not.toBeNull();
    expect(form?.contains(button)).toBe(true);
  });

  it("enables the create-form submit once the page has hydrated, under the same name", async () => {
    const element = <CreateForm action={neverCalledCreateAction} />;
    const button = serveAndFind(element, 'button[type="submit"]');
    expect(button.disabled).toBe(true);

    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container as HTMLElement, element);
      await Promise.resolve();
    });

    const hydrated = (container as HTMLElement).querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    expect(hydrated?.disabled).toBe(false);
    expect(hydrated?.textContent?.trim()).toBe(CREATE_SUBMIT_NAME);

    act(() => {
      root?.unmount();
    });
  });

  it("serves the question editor's Server Action form with no submit control at all", () => {
    const html = renderToString(
      <QuestionEditor
        mode="edit"
        action={neverCalledMutation}
        initialSlug="passport"
        initialDefinition={DEFINITION}
        version={2}
      />,
    );
    container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    expect(form?.querySelectorAll("input,textarea,select").length).toBeGreaterThan(0);

    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(0);
    expect(container.querySelectorAll('input[type="submit"]')).toHaveLength(0);
    expect(container.querySelectorAll('button[type="image"]')).toHaveLength(0);
  });
});
