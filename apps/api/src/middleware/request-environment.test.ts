import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiEnv } from "../openapi.js";

// Mocked rather than driven through a registered SDK: the real module is a no-op when
// no provider is registered, so a test against it would pass whatever happened here.
const setAttribute = vi.fn();
const activeSpan = { value: undefined as { setAttribute: typeof setAttribute } | undefined };

vi.mock("@opentelemetry/api", () => ({
  trace: { getActiveSpan: () => activeSpan.value },
}));

const { ENVIRONMENT_ATTRIBUTE, fixedEnvironment, requestEnvironment } =
  await import("./request-environment.js");
const { makeDeps } = await import("../test-support.js");

beforeEach(() => {
  setAttribute.mockClear();
  activeSpan.value = { setAttribute };
});

function appWith(middleware: MiddlewareHandler<ApiEnv>): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.use("*", middleware);
  app.get("/probe", (c) => c.text(String(c.get("requestEnvironment"))));
  return app;
}

describe("the environment on the span", () => {
  it("records the switcher's environment, which an admin request names (Q6)", async () => {
    const deps = makeDeps();
    const app = appWith(requestEnvironment(deps));
    const res = await app.request("/probe", { headers: { "x-qcms-environment": "test" } });

    expect(await res.text()).toBe("test");
    expect(setAttribute).toHaveBeenCalledWith(ENVIRONMENT_ATTRIBUTE, "test");
    // The allowlist naming this key lives in another module, so a rename of either side
    // is a silent drop at the exporter.
    expect(ENVIRONMENT_ATTRIBUTE).toBe("qcms.environment");
  });

  it("records a respondent group's own environment, which no request can name (Q21)", async () => {
    const app = appWith(fixedEnvironment("test"));
    const res = await app.request("/probe");

    expect(await res.text()).toBe("test");
    expect(setAttribute).toHaveBeenCalledWith(ENVIRONMENT_ATTRIBUTE, "test");
  });

  it("records nothing for an admin request that named no environment", async () => {
    const deps = makeDeps();
    const res = await appWith(requestEnvironment(deps)).request("/probe");

    expect(await res.text()).toBe("undefined");
    expect(setAttribute).not.toHaveBeenCalled();
  });

  it("refuses an environment this deployment does not serve, and records none", async () => {
    const deps = makeDeps();
    const res = await appWith(requestEnvironment(deps)).request("/probe", {
      headers: { "x-qcms-environment": "nowhere" },
    });

    // The middleware throws and this app has no error handler, so only "not 200" holds.
    expect(res.status).not.toBe(200);
    expect(setAttribute).not.toHaveBeenCalled();
  });

  it("costs nothing when there is no active span, which is tracing switched off", async () => {
    activeSpan.value = undefined;
    const deps = makeDeps();
    const res = await appWith(requestEnvironment(deps)).request("/probe", {
      headers: { "x-qcms-environment": "test" },
    });

    expect(await res.text()).toBe("test");
  });
});
