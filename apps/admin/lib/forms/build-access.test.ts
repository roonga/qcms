import { describe, expect, it } from "vitest";

import type { MyAccess, MyAccessWorkspace } from "../membership/types.ts";

import { builderFormName, holdsEditForms, mayBuildForm } from "./build-access.ts";
import type { FormPublishingWorkflow } from "./types.ts";

function workspace(
  workspaceId: string,
  roles: readonly string[],
  archived = false,
): MyAccessWorkspace {
  return {
    workspaceId,
    slug: workspaceId,
    name: workspaceId,
    archived,
    memberRole: null,
    grants: [{ name: "Group", roles, environments: [] }],
    environments: [],
  };
}

function access(...workspaces: MyAccessWorkspace[]): MyAccess {
  return {
    userId: "usr_1",
    installationAdmin: false,
    capabilities: {
      authoring: true,
      operations: false,
      workspaces: false,
      siteConfiguration: false,
    },
    workspaces,
    siteAdministrators: [],
  };
}

const WORKFLOW: FormPublishingWorkflow = {
  enabled: true,
  environment: "prod",
  canEdit: false,
  canPublish: false,
  canRelease: false,
  eligibleVersions: [],
  preferredVersion: null,
  currentVersion: null,
};

describe("who reaches a form's builder", () => {
  it("opens for a caller the API lets write the draft", () => {
    expect(mayBuildForm({ canWriteDraft: true })).toBe(true);
  });

  it("is refused to a View forms holder, whom the API does not let write", () => {
    expect(mayBuildForm({ canWriteDraft: false })).toBe(false);
  });

  it("is refused where the publishing workflow makes the form review-only", () => {
    expect(mayBuildForm({ canWriteDraft: true, workflow: WORKFLOW })).toBe(false);
    expect(mayBuildForm({ canWriteDraft: true, workflow: { ...WORKFLOW, canEdit: true } })).toBe(
      true,
    );
  });
});

describe("who is offered a new form's builder", () => {
  it("needs Edit forms in the current workspace", () => {
    expect(holdsEditForms(access(workspace("ws_a", ["forms.editor"])), "ws_a")).toBe(true);
    expect(holdsEditForms(access(workspace("ws_a", ["forms.viewer"])), "ws_a")).toBe(false);
    expect(holdsEditForms(access(workspace("ws_b", ["forms.editor"])), "ws_a")).toBe(false);
  });

  it("takes no other form role, and no archived workspace, as Edit forms", () => {
    expect(
      holdsEditForms(access(workspace("ws_a", ["forms.publisher", "forms.owner"])), "ws_a"),
    ).toBe(false);
    expect(holdsEditForms(access(workspace("ws_a", ["forms.editor"], true)), "ws_a")).toBe(false);
  });

  it("looks in every workspace when none is selected", () => {
    expect(
      holdsEditForms(
        access(workspace("ws_a", ["forms.viewer"]), workspace("ws_b", ["forms.editor"])),
        undefined,
      ),
    ).toBe(true);
  });

  it("offers the entry when the record cannot be read, since the API still refuses", () => {
    expect(holdsEditForms(undefined, "ws_a")).toBe(true);
  });
});

describe("the name the builder shows", () => {
  it("is the draft's title in the default locale, else the slug", () => {
    const draft = { formId: "frm_a", defaultLocale: "en", title: {}, steps: [], rules: [] };
    expect(
      builderFormName({
        slug: "alpha",
        defaultLocale: "en",
        draft: { ...draft, title: { en: " Alpha " } },
      }),
    ).toBe("Alpha");
    expect(builderFormName({ slug: "alpha", defaultLocale: "en", draft })).toBe("alpha");
    expect(builderFormName({ slug: "alpha", defaultLocale: "en", draft: null })).toBe("alpha");
  });
});
