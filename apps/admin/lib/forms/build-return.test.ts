import { describe, expect, it } from "vitest";

import {
  builderExitHref,
  builderPublishHref,
  publishReturnHref,
  rememberedBuilderReturn,
} from "./build-return.ts";

const FORM = "frm_alpha";
const BUILD = "/forms/frm_alpha/build";
const FORM_PAGE = "/forms/frm_alpha";

describe("the publish wizard's returnTo", () => {
  it("is absent when none was asked for", () => {
    expect(publishReturnHref(FORM, undefined)).toBeUndefined();
  });

  it("honours this form's own build screen", () => {
    expect(publishReturnHref(FORM, BUILD)).toBe(BUILD);
    expect(publishReturnHref(FORM, [BUILD])).toBe(BUILD);
  });

  it.each([
    ["an absolute URL", "https://evil.example/forms/frm_alpha/build"],
    ["an absolute URL on the admin's own scheme", "http://localhost/forms/frm_alpha/build"],
    ["a protocol-relative URL", "//evil.example/forms/frm_alpha/build"],
    ["another form's builder", "/forms/frm_beta/build"],
    ["an encoded slash", "/forms/frm_alpha%2Fbuild"],
    ["an encoded backslash", "/forms/frm_alpha/build%5C"],
    ["a backslash path", "/\\evil.example/forms/frm_alpha/build"],
    ["an encoded form id segment", "/forms%2Ffrm_alpha%2Fbuild"],
    ["the form page", FORM_PAGE],
    ["another path of the same form", "/forms/frm_alpha/versions"],
    ["a trailing slash", `${BUILD}/`],
    ["a query on the path", `${BUILD}?x=1`],
    ["a fragment on the path", `${BUILD}#top`],
    ["a dot segment", "/forms/frm_alpha/../frm_alpha/build"],
    ["an empty value", ""],
    ["two values", [BUILD, BUILD]],
  ])("refuses %s and falls back to the form page", (_name, raw) => {
    expect(publishReturnHref(FORM, raw)).toBe(FORM_PAGE);
  });

  it("compares against the encoded id, so an id needing escapes still round-trips", () => {
    expect(publishReturnHref("frm a", "/forms/frm%20a/build")).toBe("/forms/frm%20a/build");
    expect(publishReturnHref("frm a", "/forms/frm a/build")).toBe("/forms/frm%20a");
  });

  it("is what the builder's Publish asks for", () => {
    const url = new URL(builderPublishHref(FORM), "https://admin.example");
    expect(url.pathname).toBe("/forms/frm_alpha/publish");
    expect(publishReturnHref(FORM, url.searchParams.get("returnTo") ?? undefined)).toBe(BUILD);
  });
});

describe("the builder's Exit", () => {
  it("returns a new form to the New form screen", () => {
    expect(builderExitHref(null, "/forms")).toBe("/forms/new");
    expect(builderExitHref(null, null)).toBe("/forms/new");
  });

  it("returns to the entry point this tab recorded", () => {
    expect(builderExitHref(FORM, "/forms")).toBe("/forms");
    expect(builderExitHref(FORM, "/forms?status=open")).toBe("/forms?status=open");
    expect(builderExitHref(FORM, FORM_PAGE)).toBe(FORM_PAGE);
    expect(builderExitHref(FORM, "/forms/new")).toBe("/forms/new");
  });

  it.each([
    ["nothing recorded", null],
    ["another form", "/forms/frm_beta"],
    ["an unrelated screen", "/questions"],
    ["another origin", "https://evil.example/forms"],
    ["a protocol-relative address", "//evil.example/forms"],
    ["a relative address", "forms"],
  ])("falls back to the form page from %s", (_name, cameFrom) => {
    expect(builderExitHref(FORM, cameFrom)).toBe(FORM_PAGE);
  });

  it("never records a build route as an entry point", () => {
    expect(rememberedBuilderReturn(BUILD, "")).toBeUndefined();
    expect(rememberedBuilderReturn("/forms/new/build", "")).toBeUndefined();
    expect(rememberedBuilderReturn("/forms", "?q=a")).toBe("/forms?q=a");
  });
});
