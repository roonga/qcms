import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DraftForm, DraftPin, PinnableQuestion } from "../../lib/forms/types.ts";
import { LibraryPicker } from "./library-picker.tsx";
import { TableColumnView } from "./table-column-view.tsx";

/**
 * The admin side of the table presentation (task 077, ADR-43, plan section 6.3): the
 * **column view** of a group's member list and the **filtered library picker**.
 *
 * It is the acceptance-case-62 substance at the layer it can be stated at today. The case
 * is written `(browser, admin project)`, and the browser walk it asks for opens the picker
 * from the group panel's Add-column control - which is task 074's panel, still in flight
 * beside this one. Both pieces here take their inputs as props and reach into no panel
 * state, so the walk is the panel's wiring and nothing else; the handback records it.
 *
 * The jsdom layer rather than `renderToStaticMarkup`, because the picker is a react-aria
 * `Dialog` and a Dialog renders through a portal that server rendering has nowhere to put,
 * so a static render hands back the empty string for the whole subtree (issue #628,
 * recorded in `lib/forms/picker-selection.ts`).
 */

function question(questionId: string, type: PinnableQuestion["type"]): PinnableQuestion {
  return {
    questionId,
    slug: questionId.replace("q_", ""),
    label: { en: `The ${questionId}` },
    type,
    // `definition` is required by the type and irrelevant to every rule here: nothing
    // reads past the version's `status` and the question's own `type`.
    versions: [
      {
        version: 1,
        status: "published",
        definition: { questionId, type: type ?? "shortText", label: { en: questionId } },
      },
    ],
  };
}

const LIBRARY: readonly PinnableQuestion[] = [
  question("q_plate", "shortText"),
  question("q_odometer", "number"),
  question("q_serviced", "date"),
  question("q_garaged", "boolean"),
  question("q_use", "singleChoice"),
  question("q_notes", "longText"),
  question("q_extras", "multiChoice"),
];

const pin = (questionId: string): DraftPin => ({ questionId, version: 1 });

const DRAFT: DraftForm = {
  formId: "frm_fleet",
  defaultLocale: "en",
  title: { en: "Fleet cover" },
  steps: [{ stepId: "stp_fleet", title: { en: "Vehicles" }, items: [] }],
  rules: [],
};

describe("the column view", () => {
  it("draws one row per column, in order, with the type shown and not chosen", () => {
    render(
      <TableColumnView
        members={[pin("q_plate"), pin("q_odometer")]}
        library={LIBRARY}
        onAddColumn={() => {}}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    // The type cell is TEXT. A chooser here would imply a table column has a type of its
    // own, which is exactly the model ADR-42 refused: every cell is an ordinary question.
    for (const row of rows) {
      expect(row.querySelectorAll("input, select, textarea, button[aria-haspopup]")).toHaveLength(
        0,
      );
    }
    expect(rows[0]?.textContent).toContain("Short text");
    expect(rows[1]?.textContent).toContain("Number");
    // The column's own label is its row header: the view is a table of columns, and the
    // thing identifying each row is the header the respondent will read.
    expect(rows[0]?.querySelector('th[scope="row"]')?.textContent).toBe("The q_plate");
  });

  it("says which five types a column may be, and names the stacked presentation", () => {
    render(<TableColumnView members={[pin("q_plate")]} library={LIBRARY} />);
    const note = screen.getByTestId("column-type-note").textContent ?? "";
    expect(note).toContain("Short text");
    expect(note).toContain("stacked");
  });

  it("lists a refused column, marks it, and warns once for the panel", () => {
    render(<TableColumnView members={[pin("q_plate"), pin("q_notes")]} library={LIBRARY} />);
    // Listed rather than hidden: publish will refuse the form by naming this column, and a
    // view that dropped the row would leave the author reading about a column it does not
    // show.
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getAllByTestId("column-refused")).toHaveLength(1);
    expect(screen.getByTestId("column-types-refused")).toBeTruthy();
  });

  it("warns about nothing when every column is allowed", () => {
    render(<TableColumnView members={[pin("q_plate"), pin("q_use")]} library={LIBRARY} />);
    expect(screen.queryByTestId("column-types-refused")).toBeNull();
    expect(screen.queryByTestId("column-refused")).toBeNull();
  });

  it("offers Add column only when the panel gave it somewhere to go", () => {
    const onAddColumn = vi.fn();
    const { unmount } = render(
      <TableColumnView members={[]} library={LIBRARY} onAddColumn={onAddColumn} />,
    );
    // Adding a column IS adding a question to the group, which is what this control says.
    expect(screen.getByRole("button", { name: "Add column" })).toBeTruthy();
    unmount();
    render(<TableColumnView members={[]} library={LIBRARY} />);
    expect(screen.queryByRole("button", { name: "Add column" })).toBeNull();
  });
});

describe("the filtered library picker (acceptance case 62's substance)", () => {
  function openPicker(columnTypesOnly: boolean) {
    return render(
      <LibraryPicker
        isOpen
        stepTitle="Vehicles"
        draft={DRAFT}
        library={{ ok: true, data: LIBRARY }}
        onAddPins={() => {}}
        onClose={() => {}}
        columnTypesOnly={columnTypesOnly}
      />,
    );
  }

  it("offers only the allowed cell types", () => {
    openPicker(true);
    const listed = [...document.querySelectorAll("[data-picker-question]")].map(
      (row) => row.getAttribute("data-picker-question") ?? "",
    );
    expect(listed.toSorted()).toEqual([
      "q_garaged",
      "q_odometer",
      "q_plate",
      "q_serviced",
      "q_use",
    ]);
    expect(listed).not.toContain("q_notes");
    expect(listed).not.toContain("q_extras");
  });

  it("says why the others are absent, and names the stacked presentation", () => {
    openPicker(true);
    // A filtered library looks exactly like a short one, so an author who cannot find
    // their long-text question has no way to tell "not listed" from "not in the library".
    const note = document.querySelector('[data-testid="qcms-picker-column-note"]');
    expect(note?.textContent).toContain("Long text");
    expect(note?.textContent).toContain("stacked");
  });

  it("is the unfiltered picker by default, with no note at all", () => {
    openPicker(false);
    const listed = [...document.querySelectorAll("[data-picker-question]")].map(
      (row) => row.getAttribute("data-picker-question") ?? "",
    );
    expect(listed).toContain("q_notes");
    expect(listed).toContain("q_extras");
    expect(document.querySelector('[data-testid="qcms-picker-column-note"]')).toBeNull();
  });
});
