// Literal-string SSRF checks only (SEC-6): no DNS resolution here, so DNS-rebinding
// protection has to happen at delivery time.

export type WebhookUrlRejection =
  "not-a-url" | "unsupported-scheme" | "https-required" | "private-host";

export type WebhookUrlCheck =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: WebhookUrlRejection };

function unbracket(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function isLocalhostName(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h.endsWith(".localhost");
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1") return true; // loopback
  if (h === "::") return true; // unspecified
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7 unique-local
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) {
    return true; // fe80::/10 link-local
  }
  // IPv4-mapped (::ffff:a.b.c.d) reaches the same networks as the bare v4 literal.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (mapped) return isPrivateIpv4(mapped[1]!);
  return false;
}

export function checkWebhookUrl(raw: string, allowPrivate: boolean): WebhookUrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not-a-url" };
  }

  const scheme = url.protocol;
  if (scheme !== "https:" && scheme !== "http:") {
    return { ok: false, reason: "unsupported-scheme" };
  }
  if (scheme === "http:" && !allowPrivate) {
    return { ok: false, reason: "https-required" };
  }

  if (!allowPrivate) {
    const host = unbracket(url.hostname);
    if (isLocalhostName(host) || isPrivateIpv4(host) || isPrivateIpv6(host)) {
      return { ok: false, reason: "private-host" };
    }
  }

  return { ok: true, url: url.toString() };
}
