import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DraftPreview } from "./draft-preview.tsx";
import type { DraftForm } from "../../lib/forms/types.ts";
import { t } from "../../lib/i18n/en.ts";
import { unexpected } from "../../lib/ops/unexpected.ts";

const DRAFT: DraftForm = {
  formId: "form-1",
  defaultLocale: "en",
  title: { en: "Intake" },
  steps: [{ stepId: "step-1", title: { en: "About you" }, items: [] }],
  rules: [],
};

describe("a rejected draft preview", () => {
  it("says the preview failed rather than leaving the pane on loading", async () => {
    render(
      <DraftPreview
        draft={DRAFT}
        defaultTheme="slate"
        preview={() => Promise.reject(new TypeError("fetch failed"))}
      />,
    );

    expect(
      await screen.findByText(t("forms.preview.failed", { message: unexpected() })),
    ).toBeTruthy();
    expect(screen.queryByText(t("forms.preview.loading"))).toBeNull();
  });
});
