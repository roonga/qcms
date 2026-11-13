import { describe, expect, it } from "vitest";

import { NO_CAPABILITIES } from "../shell/modes.ts";

import { holdsEraserGrantAnywhere, RESPONSES_ERASER_ROLE, type MyAccess } from "./types.ts";

function access(workspaces: MyAccess["workspaces"]): MyAccess {
  return {
    userId: "usr_1",
    installationAdmin: false,
    capabilities: NO_CAPABILITIES,
    workspaces,
  };
}

function grant(name: string, roles: readonly string[], environments: readonly string[] = []) {
  return { name, roles, environments };
}

function workspace(grants: ReturnType<typeof grant>[]) {
  return {
    workspaceId: "org_1",
    slug: "home",
    name: "Home",
    archived: false,
    memberRole: null,
    grants,
    environments: ["prod"],
  };
}

describe("holdsEraserGrantAnywhere", () => {
  it("is true when an eraser grant is held in any workspace", () => {
    expect(
      holdsEraserGrantAnywhere(
        access([workspace([grant("Response erasers", [RESPONSES_ERASER_ROLE], ["prod"])])]),
      ),
    ).toBe(true);
  });

  it("is true when the eraser role sits beside others in one group", () => {
    expect(
      holdsEraserGrantAnywhere(
        access([
          workspace([
            grant("Operators", ["responses.viewer", RESPONSES_ERASER_ROLE], ["test", "prod"]),
          ]),
        ]),
      ),
    ).toBe(true);
  });

  it("is false for a responses.viewer, which is the caller the 403 was for", () => {
    expect(
      holdsEraserGrantAnywhere(
        access([workspace([grant("Response viewers", ["responses.viewer"], ["prod"])])]),
      ),
    ).toBe(false);
  });

  it("is false for a caller with no grants at all", () => {
    expect(holdsEraserGrantAnywhere(access([workspace([])]))).toBe(false);
    expect(holdsEraserGrantAnywhere(access([]))).toBe(false);
  });

  it("finds the grant in a second workspace, not only the first", () => {
    expect(
      holdsEraserGrantAnywhere(
        access([
          workspace([grant("Authors", ["forms.editor"])]),
          {
            ...workspace([grant("Response erasers", [RESPONSES_ERASER_ROLE], ["prod"])]),
            workspaceId: "org_2",
            slug: "vehicle",
          },
        ]),
      ),
    ).toBe(true);
  });
});
