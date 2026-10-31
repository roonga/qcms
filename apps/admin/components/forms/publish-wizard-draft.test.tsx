import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PublishWizard } from "./publish-wizard.tsx";
import type { ReleaseReview } from "../../lib/forms/release-candidate.ts";
import type { DraftForm } from "../../lib/forms/types.ts";
import { t, tPlural } from "../../lib/i18n/en.ts";

/**
 * What a DRAFT source owes the author, which the builder's retired publish dialogs used to
 * owe them (Code Owner, 2026-10-31: the builder's publish dialogs are retired; the wizard
 * is the only publish entry).
 *
 * Two of the three things those dialogs taught live here now. What freezes is read back
 * before the one press that freezes it, computed from the stored draft rather than from a
 * document in a browser tab, and an agent-assisted draft says so (ADR-25). The third - the
 * anchored work list a refusal leaves - stays on the builder, because its entries move
 * focus to the rule, step or pin at fault and only the builder renders those; this file
 * asserts that the refusal names the count and points there.
 *
 * The last case is about a version source rather than a draft, and belongs beside them
 * because it is the same question asked of the confirmation: what the wizard sends is what
 * the audit record will say happened.
 */

const DRAFT: DraftForm = {
  formId: "frm_intake",
  defaultLocale: "en",
  title: { en: "Intake" },
  steps: [
    { stepId: "step-1", title: { en: "About you" }, items: [] },
    { stepId: "step-2", title: { en: "Your vehicle" }, items: [] },
  ],
  rules: [],
};

const TEST_ONLY: ReleaseReview = {
  source: { kind: "draft", draftRevision: 7 },
  workflowRevision: null,
  workflowSource: "default",
  targets: [
    {
      environment: "test",
      currentVersion: null,
      currentSequence: null,
      closed: false,
      evidence: [],
      blockers: [],
      twoPerson: { applies: false, refusedAsAuthor: false },
      protected: false,
    },
  ],
};

/** Walk a draft source to the review step with `test` chosen. */
async function toReview(props: {
  readonly confirm?: Parameters<typeof PublishWizard>[0]["confirm"];
  readonly agentAssisted?: boolean;
}) {
  const user = userEvent.setup();
  render(
    <PublishWizard
      formId="frm_intake"
      versions={[]}
      hasDraft
      canPublishDraft
      draft={DRAFT}
      {...(props.agentAssisted === undefined ? {} : { agentAssisted: props.agentAssisted })}
      review={() => Promise.resolve({ ok: true, data: TEST_ONLY })}
      confirm={props.confirm ?? (() => Promise.resolve({ status: "idle" }))}
      lookup={() => Promise.resolve({ status: "idle" })}
    />,
  );
  await user.click(screen.getByRole("button", { name: t("forms.publish.next") }));
  await user.click(await screen.findByRole("checkbox", { name: "test" }));
  await user.click(screen.getByRole("button", { name: t("forms.publish.next") }));
  await screen.findByTestId("qcms-publish-review");
  return user;
}

describe("the review step of a draft publish", () => {
  it("reads back what freezing this draft captures", async () => {
    await toReview({});

    expect(screen.getByTestId("qcms-freeze-summary").textContent).toBe(
      t("forms.publish.freezes", {
        steps: tPlural(
          "forms.publish.freezes.steps.one",
          "forms.publish.freezes.steps.other",
          2,
        ),
        pins: tPlural("forms.publish.freezes.pins.one", "forms.publish.freezes.pins.other", 0),
        rules: tPlural("forms.publish.freezes.rules.one", "forms.publish.freezes.rules.other", 0),
      }),
    );
    expect(screen.getByText(t("forms.publish.immutable"))).toBeTruthy();
    // Nothing claims agent assistance for a draft that carries none.
    expect(screen.queryByTestId("qcms-publish-provenance")).toBeNull();
  });

  it("marks an agent-assisted draft before it is frozen (ADR-25)", async () => {
    await toReview({ agentAssisted: true });

    expect(screen.getByTestId("qcms-publish-provenance")).toBeTruthy();
  });

  it("says nothing freezes for an existing version, which has nothing to freeze", async () => {
    const user = userEvent.setup();
    render(
      <PublishWizard
        formId="frm_intake"
        versions={[1]}
        hasDraft={false}
        canPublishDraft={false}
        draft={DRAFT}
        review={() =>
          Promise.resolve({
            ok: true,
            data: {
              ...TEST_ONLY,
              source: { kind: "version", version: 1, publishedBy: null },
            },
          })
        }
        confirm={() => Promise.resolve({ status: "idle" })}
        lookup={() => Promise.resolve({ status: "idle" })}
      />,
    );
    await user.click(screen.getByRole("button", { name: t("forms.publish.next") }));
    await user.click(await screen.findByRole("checkbox", { name: "test" }));
    await user.click(screen.getByRole("button", { name: t("forms.publish.next") }));
    await screen.findByTestId("qcms-publish-review");

    expect(screen.queryByTestId("qcms-freeze-summary")).toBeNull();
  });

  it("names how many issues refused the publish, and where the work list is", async () => {
    const user = await toReview({
      confirm: () =>
        Promise.resolve({
          status: "rejected",
          message: "The draft is not publishable.",
          issues: [
            { code: "STEP_WITHOUT_ITEMS", message: "A step has no items." },
            { code: "RULE_WITHOUT_TARGET", message: "A rule shows nothing." },
          ],
        }),
    });

    await user.click(screen.getByRole("button", { name: t("forms.publish.wizardConfirm") }));

    const rejected = await screen.findByTestId("qcms-publish-rejected");
    expect(rejected.textContent).toContain(
      t("forms.publish.wizardBlockedCount.other", { count: 2 }),
    );
    // The way to the anchored list, which only the builder can render.
    expect(
      screen.getByRole("link", { name: t("forms.publish.wizardBlockedLink") }).getAttribute("href"),
    ).toBe("/forms/frm_intake");
  });
});

describe("a promotion's recorded source", () => {
  it("names the environment whose release satisfied the destination, and never itself", async () => {
    const user = userEvent.setup();
    const confirm = vi
      .fn<Parameters<typeof PublishWizard>[0]["confirm"]>()
      .mockResolvedValue({ status: "done", version: 1, releases: [] });
    render(
      <PublishWizard
        formId="frm_intake"
        versions={[1]}
        hasDraft={false}
        canPublishDraft={false}
        draft={null}
        review={() =>
          Promise.resolve({
            ok: true,
            data: {
              source: { kind: "version", version: 1, publishedBy: null },
              workflowRevision: null,
              workflowSource: "default",
              targets: [
                {
                  environment: "prod",
                  currentVersion: null,
                  currentSequence: null,
                  closed: false,
                  // A rollback row in prod itself, and the promotion's real source. Only
                  // the second is a source: the API refuses one equal to its target.
                  evidence: [
                    {
                      environment: "prod",
                      version: 1,
                      sequence: 1,
                      releasedAt: "2026-10-01T00:00:00.000Z",
                    },
                    {
                      environment: "test",
                      version: 1,
                      sequence: 2,
                      releasedAt: "2026-10-02T00:00:00.000Z",
                    },
                  ],
                  blockers: [],
                  twoPerson: { applies: false, refusedAsAuthor: false },
                  protected: true,
                },
              ],
            },
          })
        }
        confirm={confirm}
        lookup={() => Promise.resolve({ status: "idle" })}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("forms.publish.next") }));
    await user.click(await screen.findByRole("checkbox", { name: "prod" }));
    await user.click(screen.getByRole("button", { name: t("forms.publish.next") }));
    await user.click(await screen.findByRole("button", { name: t("forms.publish.wizardConfirm") }));

    await screen.findByTestId("qcms-publish-result");
    expect(confirm.mock.calls[0]?.[0].targets[0]).toMatchObject({
      environment: "prod",
      fromEnvironment: "test",
    });
  });
});
