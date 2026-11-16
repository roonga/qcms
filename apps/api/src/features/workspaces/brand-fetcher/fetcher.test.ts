import net from "node:net";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  FIXTURE_PUBLIC_ADDRESS,
  FIXTURE_PUBLIC_ADDRESS_V6,
  fixtureBrandFetcher,
  fixtureResolver,
  startBrandFixtureServer,
} from "../../../../e2e/support/brand-fixture-server.js";
import type { BrandFixtureServer } from "../../../../e2e/support/brand-fixture-server.js";
import { createBrandFetcher } from "./fetcher.js";
import { createNodeTransport } from "./node-transport.js";
import { BrandFetchRefused } from "./port.js";
import type { BrandFetcher, BrandResourceKind } from "./port.js";
import { FETCH_LIMITS } from "./policy.js";

const PAGE = "<!doctype html><html><head><title>Brand</title></head><body>hi</body></html>";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let fixture: BrandFixtureServer;

beforeAll(async () => {
  fixture = await startBrandFixtureServer();
});

afterAll(async () => {
  await fixture.close();
});

beforeEach(() => {
  fixture.reset();
});

function servePage(host: string, path = "/", body: string = PAGE): void {
  fixture.route(host, path, (_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
  });
}

function redirect(host: string, path: string, location: string, cookie?: string): void {
  fixture.route(host, path, (_req, res) => {
    res.writeHead(302, { location, ...(cookie === undefined ? {} : { "set-cookie": cookie }) });
    res.end();
  });
}

async function refusal(
  fetcher: BrandFetcher,
  url: string,
  kind: BrandResourceKind = "page",
): Promise<BrandFetchRefused> {
  const outcome = await fetcher.fetch(url, kind).then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(outcome, url).toBeInstanceOf(BrandFetchRefused);
  return outcome as BrandFetchRefused;
}

describe("SEC-18 F1: https on 443, no userinfo", () => {
  it("refuses http, another port, userinfo and an IP literal before asking DNS anything", async () => {
    const resolver = fixtureResolver();
    const fetcher = fixtureBrandFetcher(fixture, { resolver });
    expect((await refusal(fetcher, "http://brand.example/")).reason).toBe("scheme");
    expect((await refusal(fetcher, "https://brand.example:8443/")).reason).toBe("port");
    expect((await refusal(fetcher, "https://user:pw@brand.example/")).reason).toBe("userinfo");
    expect((await refusal(fetcher, "https://user@brand.example/")).reason).toBe("userinfo");
    expect((await refusal(fetcher, `https://${FIXTURE_PUBLIC_ADDRESS}/`)).reason).toBe(
      "ip-literal",
    );
    expect((await refusal(fetcher, "https://[2606:2800::1]/")).reason).toBe("ip-literal");
    expect((await refusal(fetcher, "https://intranet/")).reason).toBe("no-registrable-domain");
    expect(resolver.calls).toStrictEqual([]);
    expect(fixture.requests).toStrictEqual([]);
  });

  it("reads a page on the default port, written with or without :443", async () => {
    servePage("brand.example");
    const fetcher = fixtureBrandFetcher(fixture);
    for (const url of ["https://brand.example/", "https://brand.example:443/"]) {
      const page = await fetcher.fetch(url, "page");
      expect(page.contentType).toBe("text/html");
      expect(new TextDecoder().decode(page.body)).toBe(PAGE);
    }
  });
});

describe("SEC-18 F2: every A and AAAA record public", () => {
  it.each([
    ["a mix of public and private records", [FIXTURE_PUBLIC_ADDRESS, "10.0.0.7"]],
    ["a private record in IPv4-mapped form", [FIXTURE_PUBLIC_ADDRESS, "::ffff:10.0.0.7"]],
    ["a private record in NAT64 form", [FIXTURE_PUBLIC_ADDRESS_V6, "64:ff9b::a00:7"]],
    ["loopback in mapped form", ["::ffff:127.0.0.1"]],
    ["the metadata address", ["169.254.169.254"]],
    ["a unique-local IPv6 record", ["fd12:3456::1"]],
    ["shared address space", ["100.64.0.9"]],
    ["a 6to4 record", ["2002:a00:7::1"]],
    ["no record at all", []],
  ])("refuses %s and dials nothing", async (_name, records) => {
    const dialled: string[] = [];
    const fetcher = fixtureBrandFetcher(fixture, {
      resolver: fixtureResolver(() => records),
      dialled,
    });
    const refused = await refusal(fetcher, "https://brand.example/");
    expect(["private-address", "no-address"]).toContain(refused.reason);
    expect(dialled).toStrictEqual([]);
  });

  it("accepts a public IPv6 record and a NAT64 form of a public address", async () => {
    servePage("brand.example");
    for (const records of [[FIXTURE_PUBLIC_ADDRESS_V6], ["64:ff9b::5db8:d70e"]]) {
      const fetcher = fixtureBrandFetcher(fixture, { resolver: fixtureResolver(() => records) });
      expect((await fetcher.fetch("https://brand.example/", "page")).contentType).toBe("text/html");
    }
  });
});

describe("SEC-18 F3: the connection goes to the pinned address", () => {
  it("never uses a second DNS answer: rebinding between check and connect is not reachable", async () => {
    servePage("brand.example");
    const dialled: string[] = [];
    const resolver = fixtureResolver((_host, call) =>
      call === 1 ? [FIXTURE_PUBLIC_ADDRESS] : ["127.0.0.1"],
    );
    const fetcher = fixtureBrandFetcher(fixture, { resolver, dialled });
    await fetcher.fetch("https://brand.example/", "page");
    expect(resolver.calls).toStrictEqual(["brand.example"]);
    expect(dialled).toStrictEqual([FIXTURE_PUBLIC_ADDRESS]);
  });

  it("verifies the certificate against the host name, not the address", async () => {
    servePage("mismatch.example");
    const fetcher = fixtureBrandFetcher(fixture);
    expect((await refusal(fetcher, "https://mismatch.example/")).reason).toBe("tls");
    expect(fixture.requests).toStrictEqual([]);
  });

  it("hands a proxy the pinned address and never the host name (S2)", async () => {
    servePage("brand.example");
    const fetcher = fixtureBrandFetcher(fixture, { viaProxy: true });
    const page = await fetcher.fetch("https://brand.example/", "page");
    expect(page.contentType).toBe("text/html");
    expect(fixture.connectTargets).toStrictEqual([`${FIXTURE_PUBLIC_ADDRESS}:443`]);
    expect(fixture.requests.map((r) => r.host)).toStrictEqual(["brand.example"]);
  });

  it("holds the certificate check through the proxy too", async () => {
    servePage("mismatch.example");
    const fetcher = fixtureBrandFetcher(fixture, { viaProxy: true });
    expect((await refusal(fetcher, "https://mismatch.example/")).reason).toBe("tls");
  });

  it("refuses a connection that never completes its handshake within the connect timeout", async () => {
    const silent = net.createServer(() => undefined);
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const port = (silent.address() as AddressInfo).port;
    try {
      const fetcher = createBrandFetcher({
        resolver: fixtureResolver(),
        allowedHosts: [],
        transport: createNodeTransport({
          ca: fixture.ca,
          connectTimeoutMs: 300,
          dial: () => ({ host: "127.0.0.1", port }),
        }),
      });
      expect((await refusal(fetcher, "https://brand.example/")).reason).toBe("connect-timeout");

      const throughSilentProxy = createBrandFetcher({
        resolver: fixtureResolver(),
        allowedHosts: [],
        transport: createNodeTransport({
          ca: fixture.ca,
          connectTimeoutMs: 300,
          proxy: { host: "127.0.0.1", port },
        }),
      });
      const started = Date.now();
      expect((await refusal(throughSilentProxy, "https://brand.example/")).reason).toBe("proxy");
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      silent.close();
    }
  });
});

describe("SEC-18 F4: one same-site redirect, re-validated", () => {
  it("follows one same-site redirect as a new request, resolving and checking its host again", async () => {
    redirect("www.brand.example", "/", "https://brand.example/home");
    servePage("brand.example", "/home");
    const resolver = fixtureResolver();
    const fetcher = fixtureBrandFetcher(fixture, { resolver });
    const page = await fetcher.fetch("https://www.brand.example/", "page");
    expect(page.url.href).toBe("https://brand.example/home");
    expect(resolver.calls).toStrictEqual(["www.brand.example", "brand.example"]);
  });

  it("refuses a same-site redirect whose target fails re-validation", async () => {
    redirect("www.brand.example", "/", "https://cdn.brand.example/");
    const fetcher = fixtureBrandFetcher(fixture, {
      resolver: fixtureResolver((host) =>
        host === "cdn.brand.example" ? ["192.168.1.4"] : [FIXTURE_PUBLIC_ADDRESS],
      ),
    });
    expect((await refusal(fetcher, "https://www.brand.example/")).reason).toBe("private-address");
  });

  it.each([
    ["to http", "http://brand.example/"],
    ["to another port", "https://brand.example:8443/"],
    ["with userinfo", "https://user@brand.example/"],
  ])("refuses a redirect %s", async (_name, location) => {
    redirect("www.brand.example", "/", location);
    const fetcher = fixtureBrandFetcher(fixture);
    expect(["scheme", "port", "userinfo"]).toContain(
      (await refusal(fetcher, "https://www.brand.example/")).reason,
    );
  });

  it("refuses a cross-site redirect, even to a host the certificate covers", async () => {
    redirect("brand.example", "/", "https://other-site.example/");
    servePage("other-site.example");
    const fetcher = fixtureBrandFetcher(fixture);
    expect((await refusal(fetcher, "https://brand.example/")).reason).toBe("cross-site-redirect");
    expect(fixture.requests.map((r) => r.host)).toStrictEqual(["brand.example"]);
  });

  it("refuses a second redirect", async () => {
    redirect("www.brand.example", "/", "https://brand.example/one");
    redirect("brand.example", "/one", "https://brand.example/two");
    servePage("brand.example", "/two");
    const fetcher = fixtureBrandFetcher(fixture);
    expect((await refusal(fetcher, "https://www.brand.example/")).reason).toBe("second-redirect");
    expect(fixture.requests.map((r) => r.path)).toStrictEqual(["/", "/one"]);
  });
});

describe("SEC-18 F5: an allowlisted content type, confirmed by sniff", () => {
  it("refuses a page served as another type", async () => {
    fixture.route("brand.example", "/", (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
    expect((await refusal(fixtureBrandFetcher(fixture), "https://brand.example/")).reason).toBe(
      "content-type",
    );
  });

  it("refuses a page whose bytes are not HTML", async () => {
    fixture.route("brand.example", "/", (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" }).end(PNG_SIGNATURE);
    });
    expect((await refusal(fixtureBrandFetcher(fixture), "https://brand.example/")).reason).toBe(
      "sniff",
    );
  });

  it("refuses an SVG logo and a polyglot that declares PNG", async () => {
    fixture.route("brand.example", "/logo.svg", (_req, res) => {
      res.writeHead(200, { "content-type": "image/svg+xml" }).end("<svg/>");
    });
    fixture.route("brand.example", "/logo.png", (_req, res) => {
      res
        .writeHead(200, { "content-type": "image/png" })
        .end(Buffer.concat([Buffer.from("<svg/>"), PNG_SIGNATURE]));
    });
    const fetcher = fixtureBrandFetcher(fixture);
    expect((await refusal(fetcher, "https://brand.example/logo.svg", "logo")).reason).toBe(
      "content-type",
    );
    expect((await refusal(fetcher, "https://brand.example/logo.png", "logo")).reason).toBe("sniff");
  });
});

describe("SEC-18 F6: caps on bytes, decompressed bytes and time", () => {
  it("refuses a body declared over the cap", async () => {
    fixture.route("brand.example", "/", (_req, res) => {
      res.writeHead(200, {
        "content-type": "text/html",
        "content-length": String(FETCH_LIMITS.wireBytes.page + 1),
      });
      res.end(`<html>${"a".repeat(FETCH_LIMITS.wireBytes.page - 5)}`);
    });
    expect((await refusal(fixtureBrandFetcher(fixture), "https://brand.example/")).reason).toBe(
      "too-large",
    );
  });

  it("refuses an undeclared body that streams past the cap", async () => {
    fixture.route("brand.example", "/", (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.write("<html>");
      res.end("a".repeat(FETCH_LIMITS.wireBytes.page + 10));
    });
    expect((await refusal(fixtureBrandFetcher(fixture), "https://brand.example/")).reason).toBe(
      "too-large",
    );
  });

  it("refuses a gzip bomb: a small body that decompresses past the cap", async () => {
    const bomb = gzipSync(Buffer.concat([Buffer.from("<html>"), Buffer.alloc(64 * 1024 * 1024)]));
    expect(bomb.byteLength).toBeLessThan(FETCH_LIMITS.wireBytes.page);
    fixture.route("brand.example", "/", (_req, res) => {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" }).end(bomb);
    });
    expect((await refusal(fixtureBrandFetcher(fixture), "https://brand.example/")).reason).toBe(
      "decoded-too-large",
    );
  });

  it("reads an ordinary gzip body", async () => {
    fixture.route("brand.example", "/", (_req, res) => {
      res
        .writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" })
        .end(gzipSync(PAGE));
    });
    const page = await fixtureBrandFetcher(fixture).fetch("https://brand.example/", "page");
    expect(new TextDecoder().decode(page.body)).toBe(PAGE);
  });

  it("refuses a slow body at the total time cap", async () => {
    fixture.route("brand.example", "/", (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.write("<html>");
      const drip = setInterval(() => res.write("a"), 50);
      res.on("close", () => clearInterval(drip));
    });
    const fetcher = fixtureBrandFetcher(fixture, { totalTimeoutMs: 500 });
    const started = Date.now();
    expect((await refusal(fetcher, "https://brand.example/")).reason).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe("SEC-18 F9 and S2", () => {
  it("sends no cookie or credential, even one a redirect set", async () => {
    redirect("www.brand.example", "/", "https://brand.example/", "sid=abc; Path=/; Secure");
    servePage("brand.example");
    await fixtureBrandFetcher(fixture).fetch("https://www.brand.example/", "page");
    expect(fixture.requests).toHaveLength(2);
    for (const request of fixture.requests) {
      expect(request.cookie).toBeUndefined();
      expect(request.authorization).toBeUndefined();
    }
  });

  it("narrows to an operator allowlist of hosts and their subdomains", async () => {
    servePage("www.brand.example");
    const fetcher = fixtureBrandFetcher(fixture, { allowedHosts: ["brand.example"] });
    expect((await fetcher.fetch("https://www.brand.example/", "page")).contentType).toBe(
      "text/html",
    );
    expect((await refusal(fetcher, "https://other-site.example/")).reason).toBe("not-allowlisted");
  });
});

describe("SEC-18 F10: one refusal", () => {
  it("is the same error, message and all, whatever refused it", async () => {
    fixture.route("brand.example", "/json", (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
    const fetcher = fixtureBrandFetcher(fixture, {
      resolver: fixtureResolver((host) =>
        host === "private.brand.example" ? ["10.1.1.1"] : [FIXTURE_PUBLIC_ADDRESS],
      ),
    });
    const refusals = await Promise.all(
      [
        "http://brand.example/",
        "https://brand.example:22/",
        "https://private.brand.example/",
        "https://mismatch.example/",
        "https://brand.example/json",
        "https://brand.example/missing",
      ].map((url) => refusal(fetcher, url)),
    );
    expect(new Set(refusals.map((r) => r.reason)).size).toBe(refusals.length);
    expect(new Set(refusals.map((r) => `${r.name}: ${r.message}`))).toStrictEqual(
      new Set(["BrandFetchRefused: brand fetch refused"]),
    );
  });
});
