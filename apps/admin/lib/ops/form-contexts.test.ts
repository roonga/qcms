import { describe, expect, it } from "vitest";

import { formContextHref, formContextLinks, primaryFormContext } from "./form-contexts.ts";
import type { OperationsFormRow } from "./operations-forms.ts";

/**
 * Which contexts each persona of Q87's discovery table is offered on a row.
 *
 * The personas themselves are proved against the policy in the API's
 * `operations.integration.test.ts`; what is decided here is only what the client does with
 * the cells that read came back with.
 */

function row(capabilities: readonly string[]): OperationsFormRow {
  return {
    formId: "frm_a",
    slug: "a",
    defaultLocale: "en",
    displayName: "A",
    workspace: { workspaceId: "ws_1", slug: "core", name: "Core" },
    hasRelease: true,
    release: null,
    lastReleaseAt: null,
    counts: null,
    capabilities,
  };
}

const VIEWER = ["form:read", "release:read", "link:read", "webhook:read"];

function contexts(capabilities: readonly string[]): readonly string[] {
  return formContextLinks(row(capabilities)).map((link) => link.context);
}

describe("a row's operational contexts", () => {
  it("offers a forms viewer the form, its versions, its links and its webhooks", () => {
    expect(contexts(VIEWER)).toEqual(["form", "versions", "links", "webhooks"]);
    expect(primaryFormContext(row(VIEWER))?.context).toBe("form");
  });

  it("offers a response viewer its responses and nothing else about the form", () => {
    expect(contexts(["response:read", "response:export"])).toEqual(["responses"]);
    expect(primaryFormContext(row(["response:read"]))?.context).toBe("responses");
  });

  it("offers an eraser without a viewer grant no context at all", () => {
    expect(contexts(["response:erase", "response:dispose"])).toEqual([]);
    expect(primaryFormContext(row(["response:erase"]))).toBeUndefined();
  });

  it("reads each context off its own cell rather than off a write in the same family", () => {
    // Minting a link is not reading the link list, and releasing is not reading releases.
    expect(contexts(["link:mint", "release:create", "webhook:configure"])).toEqual([]);
    expect(contexts([...VIEWER, "response:read"])).toEqual([
      "form",
      "versions",
      "links",
      "webhooks",
      "responses",
    ]);
  });

  it("addresses the form's own screen as the subtree's root", () => {
    expect(formContextHref("frm a", "form")).toBe("/forms/frm%20a");
    expect(formContextHref("frm_a", "responses")).toBe("/forms/frm_a/responses");
  });
});
