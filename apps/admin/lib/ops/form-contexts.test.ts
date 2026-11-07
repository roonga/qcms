import { describe, expect, it } from "vitest";

import {
  FORM_OPERATIONAL_CONTEXTS,
  formContextHref,
  formContextLinks,
  heldFormContexts,
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
  it("offers a forms viewer its links, webhooks and availability, and no authoring screen", () => {
    // Availability arrives with `form: read`; changing it takes `form: close`, which the API
    // checks at the act rather than at the link.
    expect(contexts(VIEWER)).toEqual(["links", "webhooks", "availability"]);
    expect(primaryFormContext(row(VIEWER))?.context).toBe("links");
    // The builder, Rules, Preview, Versions and Publish are the editor's and are not
    // offered here.
    expect(FORM_OPERATIONAL_CONTEXTS).toEqual([
      "responses",
      "links",
      "webhooks",
      "availability",
      "erase",
    ]);
  });

  it("offers a response viewer its responses and nothing else about the form", () => {
    expect(contexts(["response:read", "response:export"])).toEqual(["responses"]);
    expect(primaryFormContext(row(["response:read"]))?.context).toBe("responses");
  });

  it("offers an eraser without a viewer grant the known-target Erase screen only", () => {
    expect(contexts(["response:erase", "response:dispose"])).toEqual(["erase"]);
    expect(primaryFormContext(row(["response:erase"]))?.context).toBe("erase");
    expect(contexts(["response:dispose"])).toEqual([]);
    expect(primaryFormContext(row(["response:dispose"]))).toBeUndefined();
  });

  it("reads each context off its own cell rather than off a write in the same family", () => {
    // Minting a link is not reading the link list, and releasing is not reading releases.
    expect(contexts(["link:mint", "release:create", "webhook:configure"])).toEqual([]);
    expect(contexts([...VIEWER, "response:read"])).toEqual([
      "responses",
      "links",
      "webhooks",
      "availability",
    ]);
  });

  it("gives a form's rail the contexts it gives that form's row", () => {
    const held = [...VIEWER, "response:read"];
    expect(heldFormContexts(held)).toEqual(contexts(held));
    expect(heldFormContexts(["response:read", "response:export"])).toEqual(["responses"]);
    expect(heldFormContexts(["response:erase"])).toEqual(["erase"]);
    expect(heldFormContexts(["response:read", "response:erase"])).toEqual(["responses", "erase"]);
  });

  it("addresses every context under Operations", () => {
    expect(formContextHref("frm a", "responses")).toBe("/operations/forms/frm%20a/responses");
    expect(formContextHref("frm_a", "webhooks")).toBe("/operations/forms/frm_a/webhooks");
    expect(formContextHref("frm_a", "availability")).toBe("/operations/forms/frm_a/availability");
    expect(formContextHref("frm_a", "erase")).toBe("/operations/forms/frm_a/erase");
  });
});
