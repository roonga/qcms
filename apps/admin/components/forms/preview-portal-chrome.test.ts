import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { messages } from "../../lib/i18n/en.ts";

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const CHROME = read("./preview-portal-chrome.tsx");
const ADMIN_CSS = read("../../app/globals.css");
const PORTAL_SHELL = read("../../../portal/components/portal-shell.tsx");
const PORTAL_RAIL = read("../../../portal/components/step-rail.tsx");
const PORTAL_CSS = read("../../../portal/app/globals.css");
const PORTAL_EN = read("../../../portal/lib/i18n/en.ts");
const TAILWIND_THEME = readFileSync(
  createRequire(import.meta.url).resolve("tailwindcss/theme.css"),
  "utf8",
);

/** The portal's respondent-menu slot, which the preview toolbar stands in for. */
const NOT_MIRRORED = new Set(["ms-auto"]);

const BREAKPOINTS = { sm: "40rem", lg: "64rem" } as const;

const CONTAINER_UTILITIES: Readonly<Record<string, string>> = {
  "py-10": "padding-block: 2.5rem;",
  flex: "display: flex;",
  hidden: "display: none;",
};

function stripComments(css: string): string {
  return css.replaceAll(/\/\*[\s\S]*?\*\//gu, "");
}

function classLists(source: string): string[] {
  const lists = [
    ...source.matchAll(/className="([^"]+)"/gu),
    ...source.matchAll(/className=\{`([^`]+)`\}/gu),
    ...source.matchAll(/const (?:MARKER|ROW) =\s*"([^"]+)"/gu),
  ].map((match) => match[1] ?? "");
  return lists.filter((list) => !NOT_MIRRORED.has(list));
}

function inPreview(list: string): string {
  return list
    .replaceAll(/(?<![\w-])(sm|lg):([\w-]+)/gu, "qcms-cq-$1-$2")
    .replace("min-h-dvh", "min-h-full");
}

function ruleBody(css: string, selector: string): string {
  const source = stripComments(css);
  const at = source.indexOf(`${selector} {`);
  if (at < 0) return "";
  const start = at + selector.length + 2;
  return source.slice(start, source.indexOf("}", start)).replaceAll(/\s+/gu, " ").trim();
}

function containerBody(css: string, width: string): string {
  const source = stripComments(css);
  const head = `@container qcms-respondent (min-width: ${width}) {`;
  const at = source.indexOf(head);
  if (at < 0) return "";
  let depth = 1;
  let end = at + head.length;
  while (depth > 0 && end < source.length) {
    if (source[end] === "{") depth += 1;
    if (source[end] === "}") depth -= 1;
    end += 1;
  }
  return source.slice(at + head.length, end - 1);
}

function portalMessage(key: string): string | undefined {
  const escaped = key.replaceAll(".", "[.]");
  const match = new RegExp(`"${escaped}":\\s*"([^"]*)"`, "u").exec(PORTAL_EN);
  return match?.[1];
}

describe("the preview's portal chrome against the portal shell", () => {
  it("uses every class list of the portal's shell and rail", () => {
    const lists = [...classLists(PORTAL_SHELL), ...classLists(PORTAL_RAIL)];
    expect(lists.length).toBeGreaterThan(20);
    for (const list of lists) expect(CHROME, list).toContain(inPreview(list));
  });

  it("reads the portal's viewport breakpoints off the frame's container", () => {
    expect(PORTAL_CSS).not.toMatch(/--breakpoint-/u);
    for (const [name, width] of Object.entries(BREAKPOINTS)) {
      expect(TAILWIND_THEME).toContain(`--breakpoint-${name}: ${width};`);
    }
    const used = new Set(
      [...CHROME.matchAll(/qcms-cq-(sm|lg)-([\w-]+)/gu)].map((match) => match[0]),
    );
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) {
      const [, breakpoint = "", utility = ""] = /qcms-cq-(sm|lg)-([\w-]+)/u.exec(name) ?? [];
      const width = BREAKPOINTS[breakpoint as keyof typeof BREAKPOINTS];
      const declaration = CONTAINER_UTILITIES[utility];
      expect(declaration, `no declaration known for ${utility}`).toBeDefined();
      expect(ruleBody(containerBody(ADMIN_CSS, width), `.${name}`)).toBe(declaration);
    }
  });

  it("declares the brand mark as the portal does", () => {
    for (const selector of [".qcms-brand", ".qcms-brand__logo", ".qcms-brand__name"]) {
      const portal = ruleBody(PORTAL_CSS, selector);
      expect(portal, selector).not.toBe("");
      expect(ruleBody(ADMIN_CSS, selector), selector).toBe(portal);
    }
  });

  it("gives the page around the step Tailwind's own small text sizes, as the portal has", () => {
    expect(PORTAL_CSS).not.toMatch(/--text-(xs|sm)/u);
    const scope = stripComments(ADMIN_CSS)
      .split("}")
      .filter((block) => block.trim().startsWith(".qcms-builder-device [data-qcms-theme-scope] {"))
      .join(" ");
    for (const token of [
      "--text-xs",
      "--text-xs--line-height",
      "--text-sm",
      "--text-sm--line-height",
    ]) {
      const value = new RegExp(`${token}: ([^;]+);`, "u").exec(TAILWIND_THEME)?.[1];
      expect(value, token).toBeDefined();
      expect(scope, token).toContain(`${token}: ${value ?? ""};`);
    }
  });

  it("words the chrome as the portal does", () => {
    const pairs: Readonly<Record<string, string>> = {
      "brand.defaultName": "builder.preview.portal.brand",
      "progress.step": "builder.preview.portal.step",
      "progress.stepNamed": "builder.preview.portal.stepNamed",
      "rail.label": "builder.preview.portal.rail",
      "rail.done": "builder.preview.portal.done",
      "rail.notNeeded": "builder.preview.portal.notNeeded",
      "rail.hint": "builder.preview.portal.hint",
      "rail.toggle": "builder.preview.portal.toggle",
    };
    for (const [portal, admin] of Object.entries(pairs)) {
      expect(messages[admin as keyof typeof messages], admin).toBe(portalMessage(portal));
    }
  });
});
