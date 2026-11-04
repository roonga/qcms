import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IDLE_MUTATION, type MutationState } from "@/lib/questions/editor-state";
import type { DefinitionIssue, QuestionDefinitionView } from "@/lib/questions/types";

import { QuestionEditor } from "./question-editor";
import { QuestionPanelRows } from "./question-panel-rows";
import { QuestionSave } from "./question-save";

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

function refusing(issues: readonly DefinitionIssue[], message = "That definition was refused.") {
  return vi.fn<(state: MutationState, formData: FormData) => Promise<MutationState>>(() =>
    Promise.resolve({ status: "error", message, issues } as MutationState),
  );
}

function idle() {
  return vi.fn<(state: MutationState, formData: FormData) => Promise<MutationState>>(() =>
    Promise.resolve(IDLE_MUTATION),
  );
}

function SaveStandIn() {
  return <QuestionSave mode="edit" />;
}

async function save(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/questions/q_accident_count");
});

describe("which panel the column shows", () => {
  it("renders the panel the address names, and none of the others", () => {
    render(
      <>
        <QuestionEditor
          mode="edit"
          action={idle()}
          initialSlug="accident-count"
          initialDefinition={NUMBER_DEFINITION}
          version={1}
          addressedPanel="constraints"
        />
        <SaveStandIn />
      </>,
    );
    expect(screen.getByRole("group", { name: "Constraints" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Smallest value" })).toBeTruthy();
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

describe("the preview panel", () => {
  const PREVIEW = <div data-testid="stub-preview">the compiled respondent view</div>;

  function withPreview(panel: "content" | "preview") {
    return render(
      <>
        <QuestionEditor
          mode="edit"
          action={idle()}
          initialSlug="accident-count"
          initialDefinition={NUMBER_DEFINITION}
          version={1}
          addressedPanel={panel}
          preview={PREVIEW}
        />
        <QuestionPanelRows panels={[]} selected={panel} />
      </>,
    );
  }

  it("renders the slot the server handed in, and nothing of the form with it", () => {
    withPreview("preview");
    expect(screen.getByTestId("stub-preview")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Label" })).toBeNull();
  });

  it("is the last row of the rail, after everything the author can edit", () => {
    withPreview("content");
    const labels = screen.getAllByRole("link").map((node) => node.textContent ?? "");
    const rows = labels.filter((text) =>
      /^(Content|Constraints|Validation messages|Preview)/u.test(text),
    );
    expect(rows[rows.length - 1]).toContain("Preview");
  });

  it("says nothing about being behind until the editor is actually holding an edit", async () => {
    withPreview("preview");
    expect(screen.queryByText(/last saved/u)).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: /^Content/u }));
    const label = await screen.findByRole("textbox", { name: "Label" });
    fireEvent.change(label, { target: { value: "Accidents in the last three years" } });
    fireEvent.click(screen.getByRole("link", { name: /^Preview/u }));

    await waitFor(() => {
      expect(screen.getByText(/last saved/u)).toBeTruthy();
    });
    expect(screen.getByTestId("stub-preview")).toBeTruthy();
  });

  it("keeps the stale notice for an edit made WHILE the save was in flight", async () => {
    let settle: ((state: MutationState) => void) | undefined;
    const holding = vi.fn<(state: MutationState, formData: FormData) => Promise<MutationState>>(
      () =>
        new Promise<MutationState>((resolve) => {
          settle = resolve;
        }),
    );

    render(
      <>
        <QuestionEditor
          mode="edit"
          action={holding}
          initialSlug="accident-count"
          initialDefinition={NUMBER_DEFINITION}
          version={1}
          addressedPanel="content"
          preview={PREVIEW}
        />
        <QuestionPanelRows panels={[]} selected="content" />
        <SaveStandIn />
      </>,
    );

    fireEvent.click(screen.getByRole("link", { name: /^Preview/u }));
    await waitFor(() => {
      expect(screen.getByTestId("stub-preview")).toBeTruthy();
    });
    expect(screen.queryByText(/last saved/u)).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: /^Content/u }));
    const label = await screen.findByRole("textbox", { name: "Label" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
      await Promise.resolve();
    });
    expect(holding, "the save is in flight").toHaveBeenCalledTimes(1);
    fireEvent.change(label, { target: { value: "Typed while the save was in flight" } });

    await act(async () => {
      settle?.({ status: "saved", issues: [] });
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("link", { name: /^Preview/u }));
    await waitFor(() => {
      expect(
        screen.getByText(/last saved/u),
        "the preview is behind by the edit made during the save, and must say so",
      ).toBeTruthy();
    });
  });

  it("never appears where there is no saved version to show", () => {
    render(
      <>
        <QuestionEditor
          mode="create"
          action={idle()}
          initialSlug=""
          initialDefinition={NUMBER_DEFINITION}
          version={1}
        />
        <SaveStandIn />
      </>,
    );
    expect(screen.queryByTestId("stub-preview")).toBeNull();
    expect(document.querySelector('[data-question-panel="preview"]')).toBeNull();
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

    fireEvent.click(screen.getByRole("link", { name: /^Constraints/u }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Smallest value" })).toBeTruthy();
    });
    expect(screen.queryByRole("textbox", { name: "Label" })).toBeNull();
    expect(screen.getByRole("link", { name: /^Constraints/u }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("writes the chosen panel into the address, so a reload keeps it", () => {
    bothTrees();
    fireEvent.click(screen.getByRole("link", { name: /^Constraints/u }));
    expect(window.location.search).toBe("?panel=constraints");
    expect(window.location.pathname).toBe("/questions/q_accident_count");
  });

  it("follows the live document, so a panel appears as soon as its fields exist", async () => {
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
    expect(screen.queryByRole("link", { name: /^Validation messages/u })).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "An answer is required" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /^Validation messages/u })).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: /^Content/u }).textContent).toContain("Required");
  });
});

describe("where a refused save puts the author", () => {
  it("opens the first panel with an issue and focuses the offending control", async () => {
    render(
      <>
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
        />
        <SaveStandIn />
      </>,
    );
    await save();

    const label = await screen.findByRole("textbox", { name: "Label" });
    await waitFor(() => {
      expect(document.activeElement).toBe(label);
    });
    expect(label.getAttribute("aria-invalid")).toBe("true");
    expect(window.location.search).toBe("?panel=content");
  });

  it("stays on a panel it is already showing and still moves focus into it", async () => {
    render(
      <>
        <QuestionEditor
          mode="edit"
          action={refusing([issue(["constraints", "max"], "Largest value is out of range.")])}
          initialSlug="accident-count"
          initialDefinition={NUMBER_DEFINITION}
          version={1}
          addressedPanel="constraints"
        />
        <SaveStandIn />
      </>,
    );
    await save();

    const largest = screen.getByRole("textbox", { name: "Largest value" });
    await waitFor(() => {
      expect(document.activeElement).toBe(largest);
    });
  });

  it("focuses the error summary when no panel can show what was refused", async () => {
    render(
      <>
        <QuestionEditor
          mode="edit"
          action={refusing([issue([], "This question cannot be stored as written.")])}
          initialSlug="accident-count"
          initialDefinition={NUMBER_DEFINITION}
          version={1}
          addressedPanel="constraints"
        />
        <SaveStandIn />
      </>,
    );
    await save();

    const summary = await screen.findByTestId("qcms-question-errors");
    await waitFor(() => {
      expect(document.activeElement).toBe(summary);
    });
    expect(summary.textContent).toContain("This question cannot be stored as written.");
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
        <SaveStandIn />
      </>,
    );
    await save();

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /^Content/u }).querySelector("[data-rail-issues]")
          ?.textContent,
      ).toBe("1 issue");
    });
    expect(
      screen.getByRole("link", { name: /^Constraints/u }).querySelector("[data-rail-issues]")
        ?.textContent,
    ).toBe("2 issues");
    expect(
      screen
        .getByRole("link", { name: /^Validation messages/u })
        .querySelector("[data-rail-issues]"),
      "a panel with nothing refused carries no all-clear either",
    ).toBeNull();
  });

  it("works with no rail rendered at all, which is every narrow viewport", async () => {
    render(
      <>
        <QuestionEditor
          mode="edit"
          action={refusing([issue(["label"], "A label is required.")])}
          initialSlug="accident-count"
          initialDefinition={NUMBER_DEFINITION}
          version={1}
          addressedPanel="constraints"
        />
        <SaveStandIn />
      </>,
    );
    await save();

    const label = await screen.findByRole("textbox", { name: "Label" });
    await waitFor(() => {
      expect(document.activeElement).toBe(label);
    });
  });
});

function RailStandIn({ selected }: { readonly selected: "content" | "constraints" }) {
  return <QuestionPanelRows panels={[]} selected={selected} />;
}
