import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DraftPreview } from "./draft-preview.tsx";
import type { DraftForm } from "../../lib/forms/types.ts";
import { t } from "../../lib/i18n/en.ts";
import { unexpected } from "../../lib/ops/unexpected.ts";

/**
 * What an author sees when the preview projection REJECTS (issue #352, handler 1 of nine).
 *
 * This is the one of the nine with no button behind it: the call is made from an effect,
 * debounced, whenever the draft or the answers change. So the whole test is "render it and
 * wait", and the failure it guards is the most literal reading of the issue's phrase - the
 * pane sits on "Loading" for as long as the screen is open, because a rejected promise
 * with no `.catch` sets no state and `loading` is the state it was already in.
 *
 * The fake is the `preview` prop, which is the action edge; the debounce, the request-id
 * guard, the `.then` chain and the markup are all real. The default `findBy` timeout is
 * comfortably past the 250ms debounce.
 */

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
    // The half that names the defect: "Loading" is what an unhandled rejection leaves
    // behind, so its absence is the assertion, not a tidy-up.
    expect(screen.queryByText(t("forms.preview.loading"))).toBeNull();
  });
});
