import { describe, expect, it } from "vitest";

import { checkWebhookUrl } from "./ssrf.js";

/**
 * SSRF guard (SEC-6). Default-deny: HTTPS required, private/reserved/loopback/
 * link-local hosts rejected. The `allowPrivate` override unlocks HTTP + private
 * ranges for on-prem targets.
 */
describe("checkWebhookUrl - default policy (allowPrivate = false)", () => {
  it("accepts a public HTTPS URL", () => {
    expect(checkWebhookUrl("https://hooks.example.com/inbox", false)).toEqual({
      ok: true,
      url: "https://hooks.example.com/inbox",
    });
  });

  it("rejects plain HTTP (https required)", () => {
    expect(checkWebhookUrl("http://hooks.example.com/inbox", false)).toEqual({
      ok: false,
      reason: "https-required",
    });
  });

  it("rejects non-http(s) schemes", () => {
    expect(checkWebhookUrl("ftp://example.com/x", false).ok).toBe(false);
    expect(checkWebhookUrl("file:///etc/passwd", false).ok).toBe(false);
  });

  it("rejects a malformed URL", () => {
    expect(checkWebhookUrl("not a url", false)).toEqual({ ok: false, reason: "not-a-url" });
  });

  it.each([
    ["https://localhost/hook", "localhost"],
    ["https://sub.localhost/hook", ".localhost subdomain"],
    ["https://127.0.0.1/hook", "127.x loopback"],
    ["https://10.1.2.3/hook", "10.x private"],
    ["https://169.254.169.254/latest/meta-data", "link-local (cloud metadata)"],
    ["https://172.16.5.5/hook", "172.16/12 private"],
    ["https://192.168.0.1/hook", "192.168 private"],
    ["https://[::1]/hook", "IPv6 loopback"],
    ["https://[fd00::1]/hook", "IPv6 unique-local"],
    ["https://[fe80::1]/hook", "IPv6 link-local"],
  ])("rejects %s (%s)", (url) => {
    const result = checkWebhookUrl(url, false);
    expect(result).toEqual({ ok: false, reason: "private-host" });
  });
});

describe("checkWebhookUrl - on-prem override (allowPrivate = true)", () => {
  it("allows private HTTPS hosts", () => {
    expect(checkWebhookUrl("https://10.1.2.3/hook", true).ok).toBe(true);
    expect(checkWebhookUrl("https://localhost:8443/hook", true).ok).toBe(true);
  });

  it("allows plain HTTP for internal targets", () => {
    expect(checkWebhookUrl("http://192.168.0.10:9000/hook", true).ok).toBe(true);
  });

  it("still rejects non-http(s) schemes even under the override", () => {
    expect(checkWebhookUrl("ftp://10.0.0.1/x", true).ok).toBe(false);
  });
});
