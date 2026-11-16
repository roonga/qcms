import { getDomain } from "tldts";

import { deriveAppearance } from "@roonga/qcms-core";
import type { AppearanceSeed } from "@roonga/qcms-core";

import { DeriveResult } from "../schema.js";
import type { BrandFetcher, LogoCodec, ReencodedLogo } from "./port.js";
import { FETCH_LIMITS } from "./policy.js";

/** The page held no colour to derive from; the fetch itself succeeded. */
export class NothingToDerive extends Error {
  constructor() {
    super("nothing to derive");
    this.name = "NothingToDerive";
  }
}

export interface PageSignals {
  readonly themeColor: string | undefined;
  readonly css: string;
  readonly stylesheets: readonly URL[];
  readonly logo: URL | undefined;
}

const isSpace = (char: string | undefined): boolean =>
  char !== undefined && " \t\n\r\f".includes(char);

function skipSpace(text: string, at: number): number {
  let index = at;
  while (isSpace(text[index])) index += 1;
  return index;
}

function readValue(text: string, at: number): { readonly value: string; readonly next: number } {
  const quote = text[at];
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, at + 1);
    const stop = end === -1 ? text.length : end;
    return { value: text.slice(at + 1, stop), next: stop + 1 };
  }
  let index = at;
  while (index < text.length && !isSpace(text[index])) index += 1;
  return { value: text.slice(at, index), next: index };
}

/** A tokenizer rather than a pattern, so a hostile tag costs linear time. */
function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const text = tag.replace(/^<\w+/u, "").replace(/\/?>$/u, "");
  let index = skipSpace(text, 0);
  while (index < text.length) {
    const start = index;
    while (index < text.length && !isSpace(text[index]) && text[index] !== "=") index += 1;
    const name = text.slice(start, index).toLowerCase();
    index = skipSpace(text, index);
    let value = "";
    if (text[index] === "=") {
      const read = readValue(text, skipSpace(text, index + 1));
      value = read.value;
      index = read.next;
    }
    if (name !== "" && !attributes.has(name)) attributes.set(name, value);
    index = skipSpace(text, Math.max(index, start + 1));
  }
  return attributes;
}

function tags(html: string, name: string): Map<string, string>[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "giu"))].map((m) => attributesOf(m[0]));
}

function relTokens(attributes: Map<string, string>): string[] {
  return (attributes.get("rel") ?? "").toLowerCase().split(/\s+/u);
}

function sameSiteUrl(href: string | undefined, base: URL, site: string | null): URL | undefined {
  if (href === undefined || href.trim() === "") return undefined;
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (getDomain(url.hostname, { allowPrivateDomains: true }) !== site) return undefined;
  return url;
}

const RASTER_PATH = /\.(?:png|jpe?g|webp)$/iu;
const RASTER_TYPE = /^image\/(?:png|jpeg|webp)$/iu;

function rasterCandidate(attributes: Map<string, string>, href: string | undefined): boolean {
  const type = attributes.get("type");
  if (type !== undefined) return RASTER_TYPE.test(type.trim());
  return href !== undefined && RASTER_PATH.test(href.split(/[?#]/u)[0] ?? "");
}

/**
 * Reads only what a theme needs. Subresources are taken from the page's own registrable
 * domain alone, and a logo only where the markup says it is PNG, JPEG or WebP, so the
 * derive never fetches what it would then have to refuse.
 */
export function scanPage(html: string, pageUrl: URL): PageSignals {
  const source = html.replace(/<!--[\s\S]*?-->/gu, "");
  const site = getDomain(pageUrl.hostname, { allowPrivateDomains: true });
  const links = tags(source, "link");
  const metas = tags(source, "meta");

  const themeColor = metas
    .find((m) => m.get("name")?.toLowerCase() === "theme-color")
    ?.get("content");
  const css = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/giu)]
    .map((m) => m[1]!)
    .join("\n");
  const stylesheets = links
    .filter((l) => relTokens(l).includes("stylesheet"))
    .map((l) => sameSiteUrl(l.get("href"), pageUrl, site))
    .filter((url): url is URL => url !== undefined)
    .slice(0, FETCH_LIMITS.maxStylesheets);

  const icon = (rel: string): URL | undefined => {
    const found = links.find(
      (l) => relTokens(l).includes(rel) && rasterCandidate(l, l.get("href")),
    );
    return sameSiteUrl(found?.get("href"), pageUrl, site);
  };
  const ogImage = metas.find((m) => m.get("property")?.toLowerCase() === "og:image");
  const logo =
    icon("apple-touch-icon") ??
    icon("icon") ??
    (ogImage !== undefined && rasterCandidate(ogImage, ogImage.get("content"))
      ? sameSiteUrl(ogImage.get("content"), pageUrl, site)
      : undefined);

  return { themeColor, css, stylesheets, logo };
}

function hex2(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

/** A CSS colour as `#rrggbb`, or undefined for anything that is not a plain hex or `rgb()`. */
export function cssColor(value: string | undefined): string | undefined {
  const text = (value ?? "").trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})\b/u.exec(text)?.[1];
  if (hex !== undefined) {
    if (hex.length === 3 || hex.length === 4)
      return `#${[...hex.slice(0, 3)].map((c) => c + c).join("")}`;
    if (hex.length === 6 || hex.length === 8) return `#${hex.slice(0, 6)}`;
    return undefined;
  }
  const inner = /^rgba?\(([^)]*)\)/u.exec(text)?.[1];
  if (inner === undefined) return undefined;
  const channels = inner
    .split(/[\s,/]+/u)
    .filter((part) => part !== "")
    .slice(0, 3)
    .map(Number);
  if (channels.length !== 3 || channels.some((c) => !Number.isInteger(c))) return undefined;
  return `#${channels.map(hex2).join("")}`;
}

function chromatic(color: string): boolean {
  const channels = [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16));
  return Math.max(...channels) - Math.min(...channels) >= 48;
}

interface Rule {
  readonly selectors: readonly string[];
  readonly declarations: readonly (readonly [string, string])[];
}

/** Innermost blocks only, so a rule inside `@media` reads as its own selector. */
function rulesOf(css: string): Rule[] {
  return css.split("}").flatMap((piece) => {
    const open = piece.lastIndexOf("{");
    if (open === -1) return [];
    const head = piece.slice(0, open);
    const selector = head.slice(Math.max(head.lastIndexOf("{"), head.lastIndexOf(";")) + 1);
    return [
      {
        selectors: selector.split(",").map((part) => part.trim().toLowerCase()),
        declarations: piece
          .slice(open + 1)
          .split(";")
          .map((declaration) => declaration.split(":"))
          .filter((parts) => parts.length >= 2)
          .map(
            (parts) => [parts[0]!.trim().toLowerCase(), parts.slice(1).join(":").trim()] as const,
          ),
      },
    ];
  });
}

function customProperty(rules: readonly Rule[], names: readonly string[]): string | undefined {
  const declarations = rules.flatMap((rule) => rule.declarations);
  for (const name of names) {
    for (const [property, value] of declarations) {
      if (property.startsWith("--") && property.includes(name)) {
        const color = cssColor(value);
        if (color !== undefined) return color;
      }
    }
  }
  return undefined;
}

const ROOT_SELECTORS = new Set(["html", "body", ":root"]);

function rootDeclarations(rules: readonly Rule[]): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const rule of rules) {
    if (!rule.selectors.some((selector) => ROOT_SELECTORS.has(selector))) continue;
    for (const [property, value] of rule.declarations) declarations.set(property, value);
  }
  return declarations;
}

function mostFrequentChromatic(css: string): string | undefined {
  const counts = new Map<string, number>();
  for (const [match] of css.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/giu)) {
    const color = cssColor(match);
    if (color !== undefined && chromatic(color)) counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function seedFrom(themeColor: string | undefined, css: string): AppearanceSeed {
  const rules = rulesOf(css);
  const root = rootDeclarations(rules);
  const primary =
    cssColor(themeColor) ??
    customProperty(rules, ["primary", "brand", "accent"]) ??
    mostFrequentChromatic(css);
  if (primary === undefined) throw new NothingToDerive();
  const secondary = customProperty(rules, ["secondary"]);
  const text = cssColor(root.get("color"));
  const background = cssColor(root.get("background-color") ?? root.get("background"));
  const fontFamily = root.get("font-family")?.slice(0, 500);
  return {
    primary,
    ...(secondary === undefined || secondary === primary ? {} : { secondary }),
    ...(text === undefined ? {} : { text }),
    ...(background === undefined ? {} : { background }),
    ...(fontFamily === undefined ? {} : { fontFamily }),
  };
}

export interface DeriveDeps {
  readonly fetcher: BrandFetcher;
  readonly codec: LogoCodec;
  /** Stores the re-encoded logo and answers its key, or null where it may not be stored. */
  readonly storeLogo: (logo: ReencodedLogo) => Promise<string | null>;
}

const UTF8 = new TextDecoder("utf-8", { fatal: false });

/**
 * The page, up to two of its stylesheets and one logo, each through the fetcher on its own
 * (F8). What leaves is the strict {@link DeriveResult}: colours, a registry face and a logo
 * key, and nothing the page wrote (M1).
 */
export async function deriveTheme(deps: DeriveDeps, url: string): Promise<DeriveResult> {
  const page = await deps.fetcher.fetch(url, "page");
  const signals = scanPage(UTF8.decode(page.body), page.url);
  const sheets: string[] = [signals.css];
  for (const sheet of signals.stylesheets) {
    sheets.push(UTF8.decode((await deps.fetcher.fetch(sheet, "stylesheet")).body));
  }
  const seed = seedFrom(signals.themeColor, sheets.join("\n"));

  let logoKey: string | null = null;
  if (signals.logo !== undefined) {
    const fetched = await deps.fetcher.fetch(signals.logo, "logo");
    logoKey = await deps.storeLogo(await deps.codec.reencode(fetched.body));
  }

  const derived = deriveAppearance(seed);
  return DeriveResult.parse({
    palettes: derived.palettes,
    face: derived.face,
    pageTint: derived.pageTint,
    logoKey,
    corrections: derived.report.corrections.map((c) => ({
      palette: c.palette,
      token: c.token,
      from: c.from,
      to: c.to,
    })),
    tintDropped: derived.report.tintDropped,
  });
}
