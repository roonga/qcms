import ipaddr from "ipaddr.js";
import { getDomain } from "tldts";

import { sniffRasterLogo } from "@roonga/qcms-core";

import { refuse } from "./port.js";
import type { BrandResourceKind } from "./port.js";

/** Fixed rather than configurable: an operator can narrow egress (S2) but never widen a cap. */
export const FETCH_LIMITS = {
  dnsTimeoutMs: 3_000,
  connectTimeoutMs: 5_000,
  /** Per fetch, from the DNS query to the last body byte, redirect included. */
  totalTimeoutMs: 10_000,
  maxRedirects: 1,
  maxStylesheets: 2,
  /** What is read off the wire, before any decompression. */
  wireBytes: { page: 1_048_576, stylesheet: 524_288, logo: 524_288 },
  /** What decompression may produce, so a small compressed body cannot become a large one. */
  decodedBytes: { page: 1_048_576, stylesheet: 524_288, logo: 524_288 },
} as const;

export const CONTENT_TYPES: Readonly<Record<BrandResourceKind, readonly string[]>> = {
  page: ["text/html", "application/xhtml+xml"],
  stylesheet: ["text/css"],
  logo: ["image/png", "image/jpeg"],
};

export const ACCEPT: Readonly<Record<BrandResourceKind, string>> = {
  page: "text/html",
  stylesheet: "text/css",
  logo: "image/png, image/jpeg",
};

export interface CheckedUrl {
  readonly url: URL;
  readonly host: string;
  /** The registrable domain, which a redirect has to stay inside (F4). */
  readonly site: string;
}

function allowedByOperator(host: string, allowedHosts: readonly string[]): boolean {
  if (allowedHosts.length === 0) return true;
  return allowedHosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/**
 * F1 and S2: `https` on 443 alone, no userinfo, a host name with a registrable domain (so no
 * IP literal, single-label name or bare public suffix), and inside any operator allowlist.
 */
export function checkUrl(raw: string | URL, allowedHosts: readonly string[]): CheckedUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw refuse("url");
  }
  if (url.protocol !== "https:") throw refuse("scheme");
  // The WHATWG parser drops a default port, so an explicit `:443` reads as "" here.
  if (url.port !== "") throw refuse("port");
  if (url.username !== "" || url.password !== "") throw refuse("userinfo");
  const host = url.hostname.toLowerCase();
  if (host.startsWith("[") || ipaddr.isValid(host)) throw refuse("ip-literal");
  const site = getDomain(host, { allowPrivateDomains: true });
  if (site === null || site === "") throw refuse("no-registrable-domain");
  if (!allowedByOperator(host, allowedHosts)) throw refuse("not-allowlisted");
  url.hash = "";
  return { url, host, site };
}

function embeddedIpv4(address: ipaddr.IPv6): ipaddr.IPv4 {
  const bytes = address.toByteArray();
  return new ipaddr.IPv4(bytes.slice(12, 16));
}

/** The deprecated IPv4-compatible block `::/96`, which `ipaddr.js` reads as `unicast`. */
function ipv4Compatible(address: ipaddr.IPv6): boolean {
  return address
    .toByteArray()
    .slice(0, 12)
    .every((byte) => byte === 0);
}

/**
 * F2. Only `unicast` is public; every reserved, private, shared, link-local, loopback and
 * documentation range is something else. A mapped or NAT64 address is judged by the IPv4
 * address inside it, and 6to4, Teredo and IPv4-compatible addresses, which tunnel to an
 * address the record does not show, are refused outright.
 */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv4") return parsed.range() === "unicast";
  const v6 = parsed as ipaddr.IPv6;
  if (ipv4Compatible(v6)) return false;
  const range = v6.range();
  if (range === "ipv4Mapped" || range === "rfc6052") {
    return embeddedIpv4(v6).range() === "unicast";
  }
  return range === "unicast";
}

/** F2: refused unless every record is public, so a mix of public and private is refused too. */
export function checkAddresses(addresses: readonly string[]): string {
  if (addresses.length === 0) throw refuse("no-address");
  if (!addresses.every(isPublicAddress)) throw refuse("private-address");
  return addresses[0]!;
}

/** F4: one redirect, inside the first URL's registrable domain, re-checked from F1 as a new request. */
export function checkRedirect(
  from: CheckedUrl,
  location: string | null,
  redirectsSoFar: number,
  allowedHosts: readonly string[],
): CheckedUrl {
  if (redirectsSoFar >= FETCH_LIMITS.maxRedirects) throw refuse("second-redirect");
  if (location === null || location.trim() === "") throw refuse("redirect-without-location");
  let target: URL;
  try {
    target = new URL(location, from.url);
  } catch {
    throw refuse("redirect-url");
  }
  const checked = checkUrl(target, allowedHosts);
  if (checked.site !== from.site) throw refuse("cross-site-redirect");
  return checked;
}

/** The media type alone, lowercased, from a `Content-Type` value. */
export function mediaTypeOf(contentType: string | null): string {
  return (contentType ?? "").split(";")[0]!.trim().toLowerCase();
}

const HTML_SIGNATURES = [
  "<!doctype html",
  "<html",
  "<head",
  "<body",
  "<script",
  "<iframe",
  "<h1",
  "<div",
  "<font",
  "<table",
  "<a",
  "<style",
  "<title",
  "<b",
  "<br",
  "<p",
  "<!--",
  "<meta",
  "<link",
];

function leadingText(bytes: Uint8Array, length: number): string {
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  while (start < bytes.length && [0x09, 0x0a, 0x0c, 0x0d, 0x20].includes(bytes[start]!)) start++;
  return new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(start, start + length))
    .toLowerCase();
}

/** The WHATWG MIME sniffing HTML signatures: a tag name followed by a space or `>`. */
function sniffsAsHtml(bytes: Uint8Array): boolean {
  const head = leadingText(bytes, 32);
  return HTML_SIGNATURES.some((signature) => {
    if (!head.startsWith(signature)) return false;
    if (signature === "<!--") return true;
    const next = head.charAt(signature.length);
    return next === " " || next === ">";
  });
}

/** Text with no NUL and no leading markup: a stylesheet has no magic number, so this is what is checked. */
function sniffsAsStylesheet(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  return !leadingText(bytes, 1).startsWith("<");
}

const SNIFFS: Readonly<Record<BrandResourceKind, (body: Uint8Array, declared: string) => boolean>> =
  {
    page: (body) => sniffsAsHtml(body),
    stylesheet: (body) => sniffsAsStylesheet(body),
    logo: (body, declared) => sniffRasterLogo(body) === declared,
  };

/** F5: the declared type must be on the list for its kind and agree with what the bytes are. */
export function checkContent(
  kind: BrandResourceKind,
  contentType: string | null,
  body: Uint8Array,
): string {
  const declared = mediaTypeOf(contentType);
  if (!CONTENT_TYPES[kind].includes(declared)) throw refuse("content-type");
  if (body.byteLength === 0) throw refuse("empty-body");
  if (!SNIFFS[kind](body, declared)) throw refuse("sniff");
  return declared;
}
