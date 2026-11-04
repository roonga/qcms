import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ADMIN_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function routeFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      out.push(...routeFiles(full, `${prefix}/${entry}`));
      continue;
    }
    if (/^(route|page)\.tsx?$/.test(entry)) out.push(`${prefix}/${entry}`);
  }
  return out;
}

describe("SEC-1: no self-registration path exists", () => {
  const routes = routeFiles(`${ADMIN_ROOT}app`);

  it("declares a non-trivial route tree", () => {
    expect(routes.length).toBeGreaterThan(8);
  });

  it("mounts no better-auth catch-all handler", () => {
    const catchAlls = routes.filter((r) => r.includes("[..."));
    expect(catchAlls).toEqual([]);
  });

  it("declares no route named for registration", () => {
    const suspicious = routes.filter((r) =>
      /(sign-up|signup|register|registration|invite)/i.test(r),
    );
    expect(suspicious).toEqual([]);
  });

  it("calls signUpEmail only from the first-run bootstrap, never from a route", () => {
    const callers = routes.filter((route) =>
      readFileSync(`${ADMIN_ROOT}app${route}`, "utf8").includes("signUpEmail"),
    );
    expect(callers).toEqual([]);
  });
});
