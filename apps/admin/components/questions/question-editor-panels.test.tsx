import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IDLE_MUTATION, type MutationState } from "@/lib/questions/editor-state";
import type { DefinitionIssue, QuestionDefinitionView } from "@/lib/questions/types";

import { QuestionEditor } from "./question-editor";
import { QuestionPanelRows } from "./question-panel-rows";

/**
 * One panel at a time, and where a refused save puts the author (Code Owner, 2026-09-27).
 *
 * `lib/questions/panels.test.ts` pins which panels a document has and which one owns an issue.
 * What only a rendered, driven editor can show is the four things this file is about, and each
 * of them used to be unreachable below Playwright:
 *
 * - the column renders the panel the ADDRESS names, and only that one;
 * - a rail row in **another React tree** switches it, which is the whole point of
 *   `lib/questions/editor-bridge.ts` and cannot be seen from inside either tree;
 * - a refused save opens the first panel carrying an issue and moves focus to the offending
 *   control, so an error is never reported into a panel nobody is looking at;
 * - a refusal no panel can place focuses the error summary instead, which is exit criterion
 *   1's "every error surfaced somewhere readable" with one panel on screen rather than seven.
 *
 * ## Why this layer rather than the browser
 *
 * The refusal originates server-side, inside a server action, so forcing one from Playwright
 * means making the API refuse a specific document; here the action is a `vi.fn` that returns
 * the verdict under examination, which makes "a constraint issue and a label issue arrive
 * together" a one-line case rather than a fixture. That is the reason
 * `vitest.dom.config.ts` exists (issue #352). The browser still covers the parts that are
 * geometry and navigation (`e2e/questions-rail.pw.ts`).
 *
 * ## The rail stand-in is the real rail's rows
 *
 * `QuestionPanelRows` is imported rather than mocked, because the claim being tested is that
 * two trees share one selection through a module. A stand-in that called the module directly
 * would prove the module works and say nothing about the component the app actually renders.
 */

const NUMBER_DEFINITION = {
  questionId: "q_accident_count",
  type: "number",
  label: { en: "Accidents in the last five years" },
  required: true,
  constraints: { min: 0, max: 20, integer: true },
} as unknown as QuestionDefinitionView;

function issue(path: readonly string[], message: string): DefinitionIssue {
  return { code: "INVALID_QUESTION_DEFINITION", message, path };
}

/**
 * An action that refuses once, with the issues handed in.
 *
 * `submitted` is deliberately absent: this is a refusal arriving at a hydrated form, where the
 * editor keeps the document it already holds. The pre-hydration full POST path, which is the
 * one `submitted` exists for, is covered by `questions-lifecycle.pw.ts`.
 */
function refusing(issues: readonly DefinitionIssue[], message = "That definition was refused.") {
  return vi.fn<(state: MutationState, formData: FormData) => Promise<MutationState>>(() =>
    Promise.resolve({ status: "error", message, issues } as MutationState),
  );
}

/** An action that is never expected to be called. */
function idle() {
  return vi.fn<(state: MutationState, formData: FormData) => Promise<MutationState>>(() =>
    Promise.resolve(IDLE_MUTATION),
  );
}

/**
 * Press Save and let the action settle.
 *
 * `act` wrapped around the press rather than awaited inside it: the form action, the state it
 * returns and the two effects that read it all land in React's own queue, and this is React's
 * documented way of draining that queue before an assertion. The callback has nothing of its own
 * to await, which is why it resolves an already-settled promise instead.
 */
async function save(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  // The panel is written into the address when one is chosen, and the store that holds the
  // choice is a module - so each case starts from a clean address. The choice itself is
  // cleared by the editor's own unmount, which `cleanup` triggers between tests.
  window.history.replaceState(null, "", "/questions/q_accident_count");
});

describe("which panel the column shows", () => {
  it("renders the panel the address names, and none of the others", () => {
    render(
      <QuestionEditor
        mode="edit"
        action={idle()}
        initialSlug="accident-count"
        initialDefinition={NUMBER_DEFINITION}
        version={1}
        addressedPanel="constraints"
      />,
    );
    expect(screen.getByRole("group", { name: "Constraints" })).toBeTruthy();
    // `textbox` rather than `spinbutton`, which is the vendored `NumberField` rather than a
    // choice: it renders `type="text"` with `inputmode="numeric"` and an
    // `aria-roledescription`, so a numeric constraint is reached the same way
    // `e2e/support/questions.ts`'s `field()` reaches one.
    expect(screen.getByRole("textbox", { name: "Smallest value" })).toBeTruthy();
    // The label lives in Content, which is not the panel the address named.
    expect(screen.queryByRole("textbox", { name: "Label" })).toBeNull();
  });

  it("carries the id the rail row controls on the panel's own section", () => {
    const { container } = render(
      <QuestionEditor
        mode="edit"
        action={idle()}
        initialSlug="accident-count"
        initialDefinition={NUMBER_DEFINITION}
        version={1}
        addressedPanel="constraints"
      />,
    );
    expect(container.querySelector("#panel-constraints")).toBeTruthy();
    expect(container.querySelectorAll("[data-question-panel]")).toHaveLength(1);
  });

  it("shows every panel where there is no rail to switch them", () => {
    // `/questions/new` passes no panel, because it has no rail. Creation is one pass through a
    // short document, and the stacked column is right for it.
    const { container } = render(
      <QuestionEditor
        mode="create"
        action={idle()}
        initialSlug=""
        initialDefinition={NUMBER_DEFINITION}
        version={1}
      />,
    );
    expect(container.querySelectorAll("[data-question-panel]").length).toBeGreaterThan(1);
    expect(screen.getByRole("textbox", { name: "Label" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Smallest value" })).toBeTruthy();
  });
});

describe("the rail row and the column, in two React trees", () => {
  function bothTrees(addressedPanel: "content" | "constraints" = "content") {
    return render(
      <>
        <QuestionEditor
          mode="edit"
          action={idle()}
          initialSlug="accident-count"
          initialDefinition={NUMBER_DEFINITION}
          version={1}
          addressedPanel={addressedPanel}
        />
        <RailStandIn selected={addressedPanel} />
      </>,
    );
  }

  it("switches the column when a rail row is pressed, and marks that row current", async () => {
    bothTrees();
    expect(screen.getByRole("textbox", { name: "Label" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Constraints/u }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Smallest value" })).toBeTruthy();
    });
    expect(screen.queryByRole("textbox", { name: "Label" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /^Constraints/u }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("writes the chosen panel into the address, so a reload keeps it", () => {
    bothTrees();
    fireEvent.click(screen.getByRole("button", { name: /^Constraints/u }));
    expect(window.location.search).toBe("?panel=constraints");
    // Replaced rather than pushed: the panels are one screen's worth of one question, not five
    // places the reader went, so Back leaves the screen.
    expect(window.location.pathname).toBe("/questions/q_accident_count");
  });

  it("follows the live document, so a panel appears as soon as its fields exist", async () => {
    // A question with nothing set carries no authored message key, so Validation messages is
    // absent until it does. Ticking "an answer is required" is the smallest edit that adds one,
    // and the rail growing a row for it without a round trip is the whole claim: the rows read
    // the document the editor is holding rather than the one it last saved.
    render(
      <>
        <QuestionEditor
          mode="edit"
          action={idle()}
          initialSlug="notes"
          initialDefinition={
            {
              questionId: "q_notes",
              type: "longText",
              label: { en: "Anything else" },
            } as unknown as QuestionDefinitionView
          }
          version={1}
          addressedPanel="content"
        />
        <RailStandIn selected="content" />
      </>,
    );
    expect(screen.queryByRole("button", { name: /^Validation messages/u })).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "An answer is required" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Validation messages/u })).toBeTruthy();
    });
    // And the Content row's own digest follows the same edit.
    expect(screen.getByRole("button", { name: /^Content/u }).textContent).toContain("Required");
  });
});

describe("where a refused save puts the author", () => {
  it("opens the first panel with an issue and focuses the offending control", async () => {
    render(
      <QuestionEditor
        mode="edit"
        action={refusing([
          issue(["constraints", "max"], "Largest value must be above the smallest."),
          issue(["label"], "A label is required."),
        ])}
        initialSlug="accident-count"
        initialDefinition={NUMBER_DEFINITION}
        version={1}
        addressedPanel="constraints"
      />,
    );
    await save();

    // Panel order, not issue order: the author is sent to the first thing to fix reading
    // downwards, which is the order they wrote the question in.
    const label = await screen.findByRole("textbox", { name: "Label" });
    await waitFor(() => {
      expect(document.activeElement).toBe(label);
    });
    expect(label.getAttribute("aria-invalid")).toBe("true");
    // And the address followed, so a reload lands on the panel that has to be fixed.
    expect(window.location.search).toBe("?panel=content");
  });

  it("stays on a panel it is already showing and still moves focus into it", async () => {
    render(
      <QuestionEditor
        mode="edit"
        action={refusing([issue(["constraints", "max"], "Largest value is out of range.")])}
        initialSlug="accident-count"
        initialDefinition={NUMBER_DEFINITION}
        version={1}
        addressedPanel="constraints"
      />,
    );
    await save();

    const largest = screen.getByRole("textbox", { name: "Largest value" });
    await waitFor(() => {
      expect(document.activeElement).toBe(largest);
    });
  });

  it("focuses the error summary when no panel can show what was refused", async () => {
    render(
      <QuestionEditor
        mode="edit"
        // No path at all, which is how the kernel reports a cross-field rule, and how any code
        // this screen has never seen arrives.
        action={refusing([issue([], "This question cannot be stored as written.")])}
        initialSlug="accident-count"
        initialDefinition={NUMBER_DEFINITION}
        version={1}
        addressedPanel="constraints"
      />,
    );
    await save();

    const summary = await screen.findByTestId("qcms-question-errors");
    await waitFor(() => {
      expect(document.activeElement).toBe(summary);
    });
    expect(summary.textContent).toContain("This question cannot be stored as written.");
    // The panel the author was on is left alone: nothing in it is at fault.
    expect(screen.getByRole("textbox", { name: "Largest value" })).toBeTruthy();
  });

  it("badges the rail row of every panel carrying an issue, and no others", async () => {
    render(
      <>
        <QuestionEditor
          mode="edit"
          action={refusing([
            issue(["label"], "A label is required."),
            issue(["constraints", "min"], "Smallest value is out of range."),
            issue(["constraints", "max"], "Largest value is out of range."),
          ])}
          initialSlug="accident-count"
          initialDefinition={NUMBER_DEFINITION}
          version={1}
          addressedPanel="content"
        />
        <RailStandIn selected="content" />
      </>,
    );
    await save();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^Content/u }).querySelector("[data-rail-issues]")
          ?.textContent,
      ).toBe("1 issue");
    });
    expect(
      screen.getByRole("button", { name: /^Constraints/u }).querySelector("[data-rail-issues]")
        ?.textContent,
    ).toBe("2 issues");
    expect(
      screen
        .getByRole("button", { name: /^Validation messages/u })
        .querySelector("[data-rail-issues]"),
      "a panel with nothing refused carries no all-clear either",
    ).toBeNull();
  });

  it("works with no rail rendered at all, which is every narrow viewport", async () => {
    // Below `--bp-sidebar` the rail is a shut `<details>`, so the panel switch and the focus
    // move cannot depend on it. Nothing but the editor is rendered here.
    render(
      <QuestionEditor
        mode="edit"
        action={refusing([issue(["label"], "A label is required.")])}
        initialSlug="accident-count"
        initialDefinition={NUMBER_DEFINITION}
        version={1}
        addressedPanel="constraints"
      />,
    );
    await save();

    const label = await screen.findByRole("textbox", { name: "Label" });
    await waitFor(() => {
      expect(document.activeElement).toBe(label);
    });
  });
});

/**
 * The rail's own panel rows, outside the editor's tree, exactly as the shell renders them.
 *
 * The `panels` prop is what the rail's slot resolves on the server; here it is a first render
 * the editor immediately replaces with its live list, which is the same sequence the app runs.
 */
function RailStandIn({ selected }: { readonly selected: "content" | "constraints" }) {
  return <QuestionPanelRows panels={[]} selected={selected} />;
}
