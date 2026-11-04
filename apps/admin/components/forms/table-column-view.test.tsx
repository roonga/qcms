import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DraftForm, DraftPin, PinnableQuestion } from "../../lib/forms/types.ts";
import { LibraryPicker } from "./library-picker.tsx";
import { TableColumnView } from "./table-column-view.tsx";

function question(questionId: string, type: PinnableQuestion["type"]): PinnableQuestion {
  return {
    questionId,
    slug: questionId.replace("q_", ""),
    label: { en: `The ${questionId}` },
    type,
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
    for (const row of rows) {
      expect(row.querySelectorAll("input, select, textarea, button[aria-haspopup]")).toHaveLength(
        0,
      );
    }
    expect(rows[0]?.textContent).toContain("Short text");
    expect(rows[1]?.textContent).toContain("Number");
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
