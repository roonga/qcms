import { getDomain } from "tldts";

import { deriveAppearance } from "@roonga/qcms-core";
import type { AppearanceSeed } from "@roonga/qcms-core";

import { DeriveResult } from "../schema.js";
import { BrandFetchRefused, LogoRefused } from "./port.js";
import type { BeforeContact, BrandFetcher, LogoCodec, ReencodedLogo } from "./port.js";
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

/**
 * Every scan is one forward pass over text already held to the F6 byte caps, and these
 * bound how much of it is examined, so a hostile page costs linear time and no more.
 */
export const SCAN_LIMITS = {
  /** A tag longer than this is skipped unread. */
  maxTagLength: 8_192,
  /** `<link>`, `<meta>` and `<style>` tags read, in document order. */
  maxTags: 4_096,
  /** CSS blocks read, counted at each closing brace. */
  maxRules: 65_536,
  /** Colour tokens counted for the most used chromatic colour. */
  maxColorTokens: 16_384,
  /** The longest `rgb()` token read. */
  maxColorFunctionLength: 64,
  /** The longest value a colour is read from. */
  maxColorValueLength: 128,
} as const;

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

/** `raw` is what follows the tag name, up to but not including the closing `>`. */
function attributesOf(raw: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const text = raw.endsWith("/") ? raw.slice(0, -1) : raw;
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

/** ASCII letters only, so every index into the result is an index into the original. */
function asciiLower(text: string): string {
  return text.replaceAll(/[A-Z]+/gu, (run) => run.toLowerCase());
}

const READ_TAGS = ["link", "meta", "style"] as const;
type ReadTag = (typeof READ_TAGS)[number];

/** The tag name at `at`, if it is one the scan reads and ends at a space, `/` or `>`. */
function readTagAt(lower: string, at: number): ReadTag | undefined {
  for (const name of READ_TAGS) {
    if (!lower.startsWith(name, at)) continue;
    const next = lower[at + name.length];
    if (next === undefined || next === "/" || next === ">" || isSpace(next)) return name;
  }
  return undefined;
}

interface Markup {
  readonly links: Map<string, string>[];
  readonly metas: Map<string, string>[];
  readonly styles: string[];
}

interface Scan {
  readonly html: string;
  readonly lower: string;
  readonly markup: Markup;
  /** The next `>` at or after the last tag read, or -1 once there is none. */
  close: number;
  tagsRead: number;
}

function readStyle(scan: Scan, after: number, readable: boolean): number {
  const end = scan.lower.indexOf("</style", after);
  if (end === -1) return -1;
  if (readable) scan.markup.styles.push(scan.html.slice(after, end));
  return scan.lower.indexOf("<", end + 1);
}

/** Reads the comment or tag at `at`, and answers where the next `<` is, or -1 to stop. */
function scanStep(scan: Scan, at: number): number {
  const { lower } = scan;
  if (lower.startsWith("<!--", at)) {
    const end = lower.indexOf("-->", at + 4);
    return end === -1 ? -1 : lower.indexOf("<", end + 3);
  }
  const name = readTagAt(lower, at + 1);
  if (name === undefined) return lower.indexOf("<", at + 1);
  if (scan.close < at) scan.close = lower.indexOf(">", at);
  if (scan.close === -1) return -1;
  scan.tagsRead += 1;
  const after = scan.close + 1;
  const readable = after - at <= SCAN_LIMITS.maxTagLength;
  if (name === "style") return readStyle(scan, after, readable);
  if (readable) {
    const attributes = attributesOf(scan.html.slice(at + 1 + name.length, scan.close));
    (name === "link" ? scan.markup.links : scan.markup.metas).push(attributes);
  }
  return lower.indexOf("<", after);
}

/**
 * Every search starts past where the last one of its kind ended, and the next `>` is found
 * once and reused, so each character is read a fixed number of times.
 */
function scanMarkup(html: string): Markup {
  const scan: Scan = {
    html,
    lower: asciiLower(html),
    markup: { links: [], metas: [], styles: [] },
    close: -1,
    tagsRead: 0,
  };
  let at = scan.lower.indexOf("<");
  while (at !== -1 && scan.tagsRead < SCAN_LIMITS.maxTags) at = scanStep(scan, at);
  return scan.markup;
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

const RASTER_PATH = /\.(?:png|jpe?g)$/iu;
const RASTER_TYPE = /^image\/(?:png|jpeg)$/iu;

function rasterCandidate(attributes: Map<string, string>, href: string | undefined): boolean {
  const type = attributes.get("type");
  if (type !== undefined) return RASTER_TYPE.test(type.trim());
  return href !== undefined && RASTER_PATH.test(href.split(/[?#]/u)[0] ?? "");
}

/**
 * Reads only what a theme needs. Subresources are taken from the page's own registrable
 * domain alone, and a logo only where the markup says it is PNG or JPEG, so the derive
 * never fetches what it would then have to refuse.
 */
export function scanPage(html: string, pageUrl: URL): PageSignals {
  const site = getDomain(pageUrl.hostname, { allowPrivateDomains: true });
  const { links, metas, styles } = scanMarkup(html);

  const themeColor = metas
    .find((m) => m.get("name")?.toLowerCase() === "theme-color")
    ?.get("content");
  const css = styles.join("\n");
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
  const text = (value ?? "").slice(0, SCAN_LIMITS.maxColorValueLength).trim().toLowerCase();
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
  const rules: Rule[] = [];
  let from = 0;
  for (let read = 0; read < SCAN_LIMITS.maxRules; read += 1) {
    const end = css.indexOf("}", from);
    if (end === -1) break;
    const piece = css.slice(from, end);
    from = end + 1;
    const open = piece.lastIndexOf("{");
    if (open === -1) continue;
    const head = piece.slice(0, open);
    const selector = head.slice(Math.max(head.lastIndexOf("{"), head.lastIndexOf(";")) + 1);
    rules.push({
      selectors: selector.split(",").map((part) => part.trim().toLowerCase()),
      declarations: piece
        .slice(open + 1)
        .split(";")
        .map((declaration) => declaration.split(":"))
        .filter((parts) => parts.length >= 2)
        .map((parts) => [parts[0]!.trim().toLowerCase(), parts.slice(1).join(":").trim()] as const),
    });
  }
  return rules;
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

/** Fixed-width alternatives with no nested quantifier: each start position costs a constant. */
const COLOR_TOKEN = /#[0-9a-f]{3,8}\b|rgba?\(/giu;

function mostFrequentChromatic(css: string): string | undefined {
  const counts = new Map<string, number>();
  let examined = 0;
  // The next `)`, found once and reused until the scan passes it; -1 once there is none.
  let close: number | undefined;
  for (const match of css.matchAll(COLOR_TOKEN)) {
    examined += 1;
    if (examined > SCAN_LIMITS.maxColorTokens) break;
    let token = match[0];
    if (!token.startsWith("#")) {
      const start = match.index;
      if (close === undefined || (close !== -1 && close < start)) close = css.indexOf(")", start);
      if (close === -1 || close - start >= SCAN_LIMITS.maxColorFunctionLength) continue;
      token = css.slice(start, close + 1);
    }
    const color = cssColor(token);
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
  /** Passed to every fetch, so each host contacted is recorded before it is (W4). */
  readonly beforeContact?: BeforeContact;
  /** Told why a refused logo was left out of a derive that otherwise succeeds. */
  readonly onLogoDropped?: (reason: string) => void;
}

const UTF8 = new TextDecoder("utf-8", { fatal: false });

async function deriveLogo(deps: DeriveDeps, url: URL): Promise<string | null> {
  let logo: ReencodedLogo;
  try {
    const fetched = await deps.fetcher.fetch(url, "logo", deps.beforeContact);
    logo = await deps.codec.reencode(fetched.body);
  } catch (err: unknown) {
    if (!(err instanceof BrandFetchRefused) && !(err instanceof LogoRefused)) throw err;
    deps.onLogoDropped?.(err.reason);
    return null;
  }
  return deps.storeLogo(logo);
}

/**
 * The page, up to two of its stylesheets and one logo, each through the fetcher on its own
 * (F8). A refused page or stylesheet refuses the derive; a refused logo leaves it without
 * one. What leaves is the strict {@link DeriveResult}: colours, a registry face and a logo
 * key, and nothing the page wrote (M1).
 */
export async function deriveTheme(deps: DeriveDeps, url: string): Promise<DeriveResult> {
  const page = await deps.fetcher.fetch(url, "page", deps.beforeContact);
  const signals = scanPage(UTF8.decode(page.body), page.url);
  const sheets: string[] = [signals.css];
  for (const sheet of signals.stylesheets) {
    const fetched = await deps.fetcher.fetch(sheet, "stylesheet", deps.beforeContact);
    sheets.push(UTF8.decode(fetched.body));
  }
  const seed = seedFrom(signals.themeColor, sheets.join("\n"));
  const logoKey = signals.logo === undefined ? null : await deriveLogo(deps, signals.logo);

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
