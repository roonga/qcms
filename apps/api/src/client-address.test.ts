/**
 * The API's half of the client-address contract (issue #341): it reads the header
 * a BFF vouched on, and nothing else.
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { CLIENT_ADDRESS_HEADER, UNKNOWN_CLIENT_ADDRESS, clientAddress } from "./client-address.js";

/** Echoes whatever `clientAddress` resolved, so a case can assert the key directly. */
function echoApp(): Hono {
  const app = new Hono();
  app.get("/", (c) => c.text(clientAddress(c)));
  return app;
}

async function resolvedFrom(headers: Record<string, string>): Promise<string> {
  const res = await echoApp().request("/", { headers });
  return res.text();
}

describe("clientAddress", () => {
  it("returns the vouched address", async () => {
    await expect(resolvedFrom({ [CLIENT_ADDRESS_HEADER]: "203.0.113.7" })).resolves.toBe(
      "203.0.113.7",
    );
  });

  it("trims surrounding whitespace so one client is one bucket", async () => {
    await expect(resolvedFrom({ [CLIENT_ADDRESS_HEADER]: "  203.0.113.7  " })).resolves.toBe(
      "203.0.113.7",
    );
  });

  it("ignores x-forwarded-for and x-real-ip entirely", async () => {
    await expect(
      resolvedFrom({ "x-forwarded-for": "10.0.0.1", "x-real-ip": "10.0.0.2" }),
    ).resolves.toBe(UNKNOWN_CLIENT_ADDRESS);
  });

  it("falls back to the shared bucket with no header, an empty one, or an over-long one", async () => {
    await expect(resolvedFrom({})).resolves.toBe(UNKNOWN_CLIENT_ADDRESS);
    await expect(resolvedFrom({ [CLIENT_ADDRESS_HEADER]: "   " })).resolves.toBe(
      UNKNOWN_CLIENT_ADDRESS,
    );
    await expect(resolvedFrom({ [CLIENT_ADDRESS_HEADER]: "a".repeat(200) })).resolves.toBe(
      UNKNOWN_CLIENT_ADDRESS,
    );
  });
});
