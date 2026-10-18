import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The environment reaches the trace (SEC-13; task 067, criterion 6).
 *
 * `telemetry-redaction.test.ts` asserts the allowlist **keeps** `qcms.environment`, which
 * is half the criterion and the half that is easy to satisfy: an attribute nothing sets is
 * allowlisted for nothing. This is the other half - that both of the two places an
 * environment is chosen record it - and it is a separate file because the two halves fail
 * for unrelated reasons.
 *
 * `@opentelemetry/api` is mocked rather than an SDK registered, because the assertion is
 * about **what this middleware does**, not about what an exporter makes of it: the real
 * module is a no-op when no provider is registered, so a test against it would pass
 * whatever the middleware did. The composed-app end of the same property is
 * `apps/admin/e2e/otel-logs.pw.ts`'s territory.
 */

const setAttribute = vi.fn();
const activeSpan = { value: undefined as { setAttribute: typeof setAttribute } | undefined };

vi.mock("@opentelemetry/api", () => ({
  trace: { getActiveSpan: () => activeSpan.value },
}));

const { ENVIRONMENT_ATTRIBUTE, fixedEnvironment, requestEnvironment } = await import(
  "./request-environment.js"
);
const { makeDeps } = await import("../test-support.js");

beforeEach(() => {
  setAttribute.mockClear();
  activeSpan.value = { setAttribute };
});

/** An app that answers with whatever the middleware left on the context. */
function appWith(middleware: Parameters<Hono["use"]>[1]): Hono {
  const app = new Hono();
  app.use("*", middleware as never);
  app.get("/probe", (c) => c.text(String((c as never as { get: (k: string) => string }).get("requestEnvironment"))));
  return app;
}

describe("the environment on the span", () => {
  it("records the switcher's environment, which an admin request names (Q6)", async () => {
    const deps = makeDeps();
    const app = appWith(requestEnvironment(deps));
    const res = await app.request("/probe", { headers: { "x-qcms-environment": "test" } });

    expect(await res.text()).toBe("test");
    expect(setAttribute).toHaveBeenCalledWith(ENVIRONMENT_ATTRIBUTE, "test");
    // The attribute key is the one the allowlist names. Asserted as the constant and as
    // its spelling, because the two live in different modules and a rename of one is a
    // silent drop at the exporter.
    expect(ENVIRONMENT_ATTRIBUTE).toBe("qcms.environment");
  });

  it("records a respondent group's own environment, which no request can name (Q21)", async () => {
    const app = appWith(fixedEnvironment("test"));
    const res = await app.request("/probe");

    expect(await res.text()).toBe("test");
    expect(setAttribute).toHaveBeenCalledWith(ENVIRONMENT_ATTRIBUTE, "test");
  });

  it("records nothing for an admin request that named no environment", async () => {
    // An absent header is not an error: the client named nothing, and the fall back to
    // `prod` happens at pool selection rather than here. So there is no environment to
    // record at this point, and recording the default would be this middleware asserting
    // a choice it did not make.
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

    // The middleware throws; this app has no error handler, so what matters here is that
    // the request did not reach the handler and no attribute was recorded for a name the
    // process holds no pool for.
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
