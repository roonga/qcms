import { describe, expect, it } from "vitest";

import { t } from "../i18n/en.ts";
import type { HeldGrant, MyAccess } from "../membership/types.ts";

import {
  eraseUnavailable,
  formsListStates,
  readOnlyNotice,
  responsesUnavailable,
  starterGroupFor,
  suspendedOnly,
} from "./role-states.ts";

function access(grants: readonly HeldGrant[], environments = ["test", "prod"]): MyAccess {
  return {
    userId: "usr_me",
    installationAdmin: false,
    capabilities: {} as MyAccess["capabilities"],
    workspaces: [
      {
        workspaceId: "ws_clinical",
        slug: "clinical",
        name: "Clinical",
        archived: false,
        memberRole: null,
        grants,
        environments,
      },
    ],
    siteAdministrators: [],
    multipleWorkspaces: false,
  };
}

const reviewers: HeldGrant = { name: "Reviewers", roles: ["forms.viewer"], environments: [] };
const authors: HeldGrant = {
  name: "Authors",
  roles: ["forms.editor", "forms.publisher", "responses.viewer"],
  environments: ["test"],
};

describe("formsListStates", () => {
  it("names the workspace and the group when Edit forms is missing", () => {
    const states = formsListStates(access([reviewers]), "ws_clinical");
    expect(states.createReason).toBe(
      "Creating a form needs Edit forms in Clinical. Authors gives it.",
    );
    expect(states.readOnly("ws_clinical")).toBe(true);
    expect(states.readOnlyReason).toBe("You have View forms. Edit forms comes from Authors.");
    expect(states.noAccessWorkspace).toBeUndefined();
  });

  it("draws nothing for an Edit forms holder", () => {
    const states = formsListStates(access([authors]), "ws_clinical");
    expect(states.createReason).toBeUndefined();
    expect(states.readOnly("ws_clinical")).toBe(false);
  });

  it("names the empty workspace for a caller with no form role there", () => {
    const states = formsListStates(
      access([{ name: "Response viewers", roles: ["responses.viewer"], environments: ["prod"] }]),
      "ws_clinical",
    );
    expect(states.noAccessWorkspace).toBe("Clinical");
  });

  it("draws no reason when the access record could not be read", () => {
    const states = formsListStates(undefined, "ws_clinical");
    expect(states.createReason).toBeUndefined();
    expect(states.readOnly("ws_clinical")).toBe(false);
  });
});

describe("readOnlyNotice", () => {
  it("names the workspace", () => {
    expect(readOnlyNotice(access([reviewers]), "ws_clinical")).toBe(
      "Read only: you have View forms in Clinical.",
    );
    expect(readOnlyNotice(undefined, "ws_clinical")).toBe(
      t("forms.unavailable.readOnlyIn", { workspace: "this workspace" }),
    );
  });
});

describe("responsesUnavailable", () => {
  it("names the environments where View responses is held", () => {
    expect(responsesUnavailable(access([authors]), "ws_clinical", "prod", "en")).toEqual({
      heading: "Responses are not available in prod",
      body: "You have View responses in test only. Response viewers gives it in prod.",
      suspended: false,
    });
  });

  it("says a suspended View responses waits for a re-confirmation", () => {
    const record = access([reviewers]);
    const suspended: MyAccess = {
      ...record,
      workspaces: record.workspaces.map((workspace) => ({
        ...workspace,
        suspended: [
          { name: "Response viewers", roles: ["responses.viewer"], environments: ["prod"] },
        ],
      })),
    };
    expect(responsesUnavailable(suspended, "ws_clinical", "prod", "en")).toMatchObject({
      body: "Your View responses in prod is suspended until a Workspace administrator re-confirms it.",
      suspended: true,
    });
    expect(responsesUnavailable(suspended, "ws_clinical", "test", "en").suspended).toBe(false);
  });

  it("names the group when View responses is held nowhere", () => {
    expect(responsesUnavailable(access([reviewers]), "ws_clinical", "test", "en").body).toBe(
      "View responses in test comes from Authors. Ask a Workspace administrator.",
    );
  });
});

describe("eraseUnavailable", () => {
  it("names Response erasers in prod only, where it carries Erase responses", () => {
    expect(eraseUnavailable("prod")).toBe(
      "Erasing responses in prod needs Erase responses there. Response erasers gives it; erasing does not need View responses.",
    );
    expect(eraseUnavailable("test")).toBe(
      "Erasing responses in test needs Erase responses there. Ask a Workspace administrator; erasing does not need View responses.",
    );
  });
});

describe("suspendedOnly", () => {
  it("holds for a workspace whose every place is suspended", () => {
    const [workspace] = access([]).workspaces;
    const place = { name: "Response viewers", roles: ["responses.viewer"], environments: ["prod"] };
    expect(
      suspendedOnly(workspace === undefined ? undefined : { ...workspace, suspended: [place] }),
    ).toBe(true);
    expect(
      suspendedOnly(
        workspace === undefined
          ? undefined
          : { ...workspace, grants: [reviewers], suspended: [place] },
      ),
    ).toBe(false);
    expect(suspendedOnly(workspace)).toBe(false);
  });

  it("tells the forms list the workspace is suspended", () => {
    const record = access([]);
    const suspended: MyAccess = {
      ...record,
      workspaces: record.workspaces.map((workspace) => ({
        ...workspace,
        suspended: [{ name: "Response viewers", roles: ["responses.viewer"], environments: [] }],
      })),
    };
    expect(formsListStates(suspended, "ws_clinical")).toMatchObject({
      suspended: true,
      noAccessWorkspace: "Clinical",
    });
  });
});

describe("starterGroupFor", () => {
  it("follows the starter groups", () => {
    expect(starterGroupFor("forms.publisher", "prod")).toBe("Publishers");
    expect(starterGroupFor("forms.publisher", "test")).toBe("Authors");
    expect(starterGroupFor("responses.eraser", "prod")).toBe("Response erasers");
    expect(starterGroupFor("responses.eraser", "test")).toBeUndefined();
  });
});
