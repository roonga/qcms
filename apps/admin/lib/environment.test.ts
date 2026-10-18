import { describe, expect, it } from "vitest";

import {
  ENVIRONMENT_COOKIE,
  confirmEnvironment,
  headerEnvironment,
  resolveEnvironment,
  selectionFromCookies,
  shownEnvironment,
} from "./environment.ts";
import { t } from "./i18n/en.ts";

/**
 * The environment's one resolution and the rule environment-sensitive actions refuse by
 * (local UX list A1, A12). Pure functions, so they are pinned here at their own layer;
 * `lib/server/environment-actions.test.ts` drives every action through the rule, and
 * `lib/server/request-environment.test.ts` shows the API header carrying the resolution.
 */

const SET = ["prod", "test"] as const;

describe("resolveEnvironment", () => {
  it("takes a selection the live set serves", () => {
    expect(resolveEnvironment("test", SET)).toEqual({
      status: "known",
      environment: "test",
      environments: SET,
      selection: "test",
    });
  });

  it("reads no selection as prod", () => {
    expect(resolveEnvironment(undefined, SET)).toMatchObject({
      status: "known",
      environment: "prod",
      selection: "",
    });
  });

  it("reads a selection the set no longer serves as prod, and keeps the raw selection", () => {
    const resolved = resolveEnvironment("staging", SET);

    expect(resolved).toMatchObject({ status: "known", environment: "prod", selection: "staging" });
    // The header names the resolution, not the stale cookie: the screen and the API agree.
    expect(headerEnvironment(resolved)).toBe("prod");
  });

  it("is unknown, never prod, when the set could not be read", () => {
    const resolved = resolveEnvironment("test", undefined);

    expect(resolved).toEqual({ status: "unknown", selection: "test" });
    expect(shownEnvironment(resolved)).toBeUndefined();
  });

  it("is unknown even with no selection, because nothing confirmed it", () => {
    expect(resolveEnvironment(undefined, undefined).status).toBe("unknown");
  });

  it("offers prod alone for an empty set, as the shell always has", () => {
    expect(resolveEnvironment("test", [])).toMatchObject({
      status: "known",
      environment: "prod",
      environments: ["prod"],
    });
  });
});

describe("headerEnvironment", () => {
  it("sends the resolved environment", () => {
    expect(headerEnvironment(resolveEnvironment("test", SET))).toBe("test");
  });

  it("still sends the selection when unknown, for the API to validate", () => {
    expect(headerEnvironment(resolveEnvironment("test", undefined))).toBe("test");
    expect(headerEnvironment(resolveEnvironment(undefined, undefined))).toBe("prod");
  });
});

describe("confirmEnvironment", () => {
  it("lets an action run in the environment its screen showed", () => {
    expect(confirmEnvironment("test", resolveEnvironment("test", SET))).toEqual({
      ok: true,
      environment: "test",
    });
  });

  it("refuses when another tab has switched, naming both environments", () => {
    expect(confirmEnvironment("prod", resolveEnvironment("test", SET))).toEqual({
      ok: false,
      message: t("environment.switched", { shown: "prod", current: "test" }),
    });
  });

  it("refuses when the request cannot confirm its environment", () => {
    expect(confirmEnvironment("test", resolveEnvironment("test", undefined))).toEqual({
      ok: false,
      message: t("environment.unconfirmed"),
    });
  });

  it("refuses a screen that rendered without one", () => {
    expect(confirmEnvironment(undefined, resolveEnvironment("test", SET))).toEqual({
      ok: false,
      message: t("environment.unconfirmed"),
    });
  });

  it("says what happened and what to do, in the catalog's words", () => {
    const message = t("environment.switched", { shown: "prod", current: "test" });
    expect(message).toContain("prod");
    expect(message).toContain("test");
    expect(message).toContain("Reload");
  });
});

describe("selectionFromCookies", () => {
  it("finds the environment cookie among others", () => {
    expect(selectionFromCookies(`a=1; ${ENVIRONMENT_COOKIE}=test; b=2`)).toBe("test");
  });

  it("reads no cookie as the empty selection the server records", () => {
    expect(selectionFromCookies("a=1")).toBe("");
    expect(selectionFromCookies("")).toBe("");
    expect(resolveEnvironment(undefined, SET).selection).toBe("");
  });

  it("does not match a cookie whose name merely ends the same way", () => {
    expect(selectionFromCookies(`x-${ENVIRONMENT_COOKIE}=test`)).toBe("");
  });
});
