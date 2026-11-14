import { describe, expect, it } from "vitest";

import { adminLink, signInLinkMessage, type SignInLinkPurpose } from "./templates.js";

const PURPOSES: readonly SignInLinkPurpose[] = ["account-created", "reactivated", "reset"];
const ADDRESS = "someone@example.test";
const LINK = "https://admin.example.test/claim?token=abc&next=%2Fforms";

describe("sign-in link templates", () => {
  it.each(PURPOSES)("%s carries the link in both parts and states the expiry", (purpose) => {
    const message = signInLinkMessage(ADDRESS, purpose, LINK);
    expect(message.to).toBe(ADDRESS);
    expect(message.subject.length).toBeGreaterThan(0);
    expect(message.text).toContain(LINK);
    expect(message.text).toContain("expires in 72 hours");
    expect(message.html).toContain(
      'href="https://admin.example.test/claim?token=abc&amp;next=%2Fforms"',
    );
  });

  it.each(PURPOSES)("%s carries nothing beyond the link: no address and no password", (purpose) => {
    const message = signInLinkMessage(ADDRESS, purpose, LINK);
    for (const part of [message.subject, message.text, message.html]) {
      expect(part).not.toContain(ADDRESS);
      expect(part.toLowerCase()).not.toMatch(/password:|temporary password|your password is/);
    }
    const withoutLink = [message.text, message.html]
      .join("\n")
      .replaceAll(LINK, "")
      .replaceAll(LINK.replaceAll("&", "&amp;"), "");
    expect(withoutLink).not.toMatch(/https?:\/\//);
  });

  it("escapes markup in the link rather than letting it into the HTML", () => {
    const message = signInLinkMessage(
      ADDRESS,
      "reset",
      'https://admin.example.test/claim?x="><script>',
    );
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&quot;&gt;&lt;script&gt;");
  });
});

describe("adminLink", () => {
  it("resolves a path on the admin origin", () => {
    expect(adminLink("https://admin.example.test", "/claim?token=abc")).toBe(
      "https://admin.example.test/claim?token=abc",
    );
  });

  it.each([
    "https://evil.example.test/claim",
    "//evil.example.test/claim",
    "/\\evil.example.test/claim",
    "claim",
  ])("refuses %s, which is not a path on the admin origin", (path) => {
    expect(() => adminLink("https://admin.example.test", path)).toThrow();
  });
});
