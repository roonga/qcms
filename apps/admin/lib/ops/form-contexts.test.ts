import { describe, expect, it } from "vitest";

import {
  FORM_OPERATIONAL_CONTEXTS,
  formContextHref,
  formContextLinks,
  primaryFormContext,
} from "./form-contexts.ts";
import type { OperationsFormRow } from "./operations-forms.ts";

// The personas are proved against the policy in the API's `operations.integration.test.ts`;
// decided here is only what the client does with the cells that read returned.

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
  it("offers a forms viewer its links, webhooks and intake, and no authoring screen", () => {
    // Intake arrives with `form: read`; changing it takes `form: close`, which the API
    // checks at the act rather than at the link.
    expect(contexts(VIEWER)).toEqual(["links", "webhooks", "intake"]);
    expect(primaryFormContext(row(VIEWER))?.context).toBe("links");
    // The builder, Rules, Preview, Versions and Publish are the editor's and are not
    // offered here.
    expect(FORM_OPERATIONAL_CONTEXTS).toEqual(["responses", "links", "webhooks", "intake"]);
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
      "responses",
      "links",
      "webhooks",
      "intake",
    ]);
  });

  it("addresses every context under Operations", () => {
    expect(formContextHref("frm a", "responses")).toBe("/operations/forms/frm%20a/responses");
    expect(formContextHref("frm_a", "webhooks")).toBe("/operations/forms/frm_a/webhooks");
    expect(formContextHref("frm_a", "intake")).toBe("/operations/forms/frm_a/intake");
  });
});
