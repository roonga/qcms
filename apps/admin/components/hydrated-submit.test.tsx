import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreateForm } from "@/app/(shell)/forms/new/create-form";
import { IDLE_CREATE_FORM, type CreateFormState } from "@/lib/forms/builder-state";
import { IDLE_MUTATION, type MutationState } from "@/lib/questions/editor-state";
import type { QuestionDefinitionView } from "@/lib/questions/types";

import { QuestionEditor } from "./questions/question-editor";

/**
 * No admin Server Action form offers a submit a browser can press before React attaches
 * (issue #1032, Code Owner ruling 2026-10-10 - option 1 of the three the issue listed;
 * issue #1050).
 *
 * ## The defect this pins
 *
 * React's server renderer gives a `<form action={formAction}>` over a `"use server"` action
 * the progressive-enhancement markup, so the served bytes are a form that posts natively.
 * This app sets `Referrer-Policy: no-referrer` on every response (`proxy.ts`), and per Fetch
 * a navigation POST under that policy carries `Origin: null`. Next's action handler compares
 * that to the host and throws: a MISSING `Origin` is let through with a warning, while the
 * literal string `null` becomes `originHost = 'null'`, fails the comparison, and - because a
 * pre-hydration post is not a fetch action - reaches `throw` rather than the flight-response
 * path. So the submission shaped like progressive enhancement is the one case the handler
 * refuses, and what the operator gets is Next's error boundary with their unsaved editor
 * state gone. `README.md`'s question-mutations bullet used to describe that post as a
 * graceful fallback, which it never was.
 *
 * Nothing here is a security control: the refusal is Next's CSRF protection working, and the
 * admin requires JavaScript anyway (`app/layout.tsx`). What is fixed is the failure mode in
 * the window between first paint and the attach, measured at 76-404ms on an idle machine for
 * issue #210 and wider under load.
 *
 * ## The two shapes, and why they get different answers
 *
 * There are exactly two Server Action forms in the served bytes of this app, and they are
 * closed differently:
 *
 * - **`app/(shell)/forms/new/create-form.tsx`** has a real in-form `type="submit"`, so the
 *   window holds a pressable control and `lib/hydrated.ts` disables it until the attach.
 *   That is the case the hydration cases below drive end to end.
 * - **`components/questions/question-editor.tsx`** has no submit control in its markup at
 *   all. Its only one is `question-save.tsx`, which returns `null` until
 *   `usePublishQuestionSave`'s effect has published the save state, and an effect runs after
 *   the hydrating commit. An absent control is stronger than a disabled one, so nothing was
 *   added there - but the property is load-bearing and invisible, so it is asserted. Adding
 *   a server-visible submit control to that screen is a red here.
 *
 * `components/questions/lifecycle-actions.tsx` posts to a Server Action too and is
 * deliberately not covered: its `ConfirmDialog` is mounted by a press, so it never appears
 * in a server render and has no window to guard. Every other admin `<form>` is `method="get"`
 * or posts to a named route handler, which is a path the `Origin: null` refusal does not
 * apply to.
 *
 * ## Why this layer
 *
 * The claim is about the difference between the server render and the hydrating one, which
 * is exactly the boundary `renderToString` plus `hydrateRoot` crosses and nothing below it
 * can see. A client-only `render()` would start from the client snapshot and report the
 * control enabled no matter what the served bytes said, so it would pass against the defect.
 *
 * ## One thing this layer cannot show, stated so nobody reads it as covered
 *
 * React emits the progressive-enhancement attributes - `method="POST"` and the hidden
 * `$ACTION_*` fields - only for a real server reference, which a build produces and a `vi.fn`
 * does not. So the forms rendered here post nowhere, and the `Origin: null` refusal itself is
 * not reproduced here; `apps/e2e` and the admin Playwright suite are where a real production
 * build is driven. What this file holds is the property the fix is: in the bytes a browser is
 * served, each of these forms offers no submit a press can reach.
 */

const DEFINITION = {
  questionId: "q_passport",
  type: "shortText",
  label: { en: "Passport number" },
  required: true,
} as unknown as QuestionDefinitionView;

// Actions that are never reached: every case here stops before a submission, which is the
// point - a press that got through would be the defect.
function neverCalledCreateAction(): Promise<CreateFormState> {
  return Promise.resolve(IDLE_CREATE_FORM);
}

function neverCalledMutation(): Promise<MutationState> {
  return Promise.resolve(IDLE_MUTATION);
}

/** The accessible name the create-form submit carries on both sides of the attach. */
const CREATE_SUBMIT_NAME = "Create form";

let container: HTMLElement | undefined;

afterEach(() => {
  container?.remove();
  container = undefined;
  vi.restoreAllMocks();
});

/**
 * Server-render `element`, put the bytes in the document, and hand back the submit button
 * as the browser sees it before React has touched anything.
 */
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

    // The native attribute, not `aria-disabled`: a disabled button is out of the tab order,
    // so a keyboard operator cannot land on a control that refuses them, which is the
    // disabled-control rule in docs/COMPONENT_GUIDELINES.md rather than a detail of it.
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-disabled")).toBeNull();
    // The accessible name is the label a reader sees, and it must be the SAME string after
    // the attach: a control whose name changes as it becomes usable is a control a
    // speech-input operator cannot address twice.
    expect(button.textContent?.trim()).toBe(CREATE_SUBMIT_NAME);
    // Inside the form it submits, so this is not a stray button somewhere else on the page:
    // the thing being disabled is the control that would have posted.
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

    // The form and its fields are there, so this is not vacuous: the markup under
    // examination is a populated editor rather than an empty or errored render.
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    expect(form?.querySelectorAll("input,textarea,select").length).toBeGreaterThan(0);

    // And nothing in the served bytes can submit it. `question-save.tsx` returns `null`
    // until its effect has published the save state, and an effect runs after the hydrating
    // commit, so the absence here is structural rather than incidental.
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(0);
    expect(container.querySelectorAll('input[type="submit"]')).toHaveLength(0);
    expect(container.querySelectorAll('button[type="image"]')).toHaveLength(0);
  });
});
