import pngjs from "pngjs";
import { describe, expect, it } from "vitest";

import { APPEARANCE_COLOR_TOKENS, APPEARANCE_FACES, PALETTE_KINDS } from "@roonga/qcms-core";

import { DeriveResult } from "../schema.js";
import { NothingToDerive, cssColor, deriveTheme, scanPage, seedFrom } from "./derive.js";
import { withIhdr } from "../../../../e2e/support/png-fixtures.js";
import { FakeBrandFetcher } from "./fake.js";
import { createLogoCodec } from "./node-codec.js";
import { BrandFetchRefused } from "./port.js";
import type { ReencodedLogo } from "./port.js";

const SENTINEL = "SENTINEL_PAGE_TEXT_7f3a";

function logoPng(): Buffer {
  const image = new pngjs.PNG({ width: 4, height: 4 });
  image.data.fill(0x99);
  return pngjs.PNG.sync.write(image);
}

const PAGE = `<!doctype html>
<html><head>
  <title>${SENTINEL} title</title>
  <meta name="theme-color" content="#1D4ED8">
  <meta property="og:title" content="${SENTINEL} og">
  <link rel="stylesheet" href="/site.css">
  <link rel="stylesheet" href="https://cdn.elsewhere.example/lib.css">
  <link rel="stylesheet" href="https://static.brand.example/extra.css">
  <link rel="stylesheet" href="/third.css">
  <link rel="icon" href="/favicon.ico">
  <link rel="icon" type="image/svg+xml" href="/logo.svg">
  <link rel="apple-touch-icon" href="/touch.png">
  <style>body { font-family: "Lexend", sans-serif; color: #111111; }</style>
</head><body><img src="/x.png" alt="${SENTINEL} alt"><p>${SENTINEL} body</p></body></html>`;

function fakeSite(): FakeBrandFetcher {
  return new FakeBrandFetcher()
    .serve("https://brand.example/", { contentType: "text/html", body: PAGE })
    .serve("https://brand.example/site.css", {
      contentType: "text/css",
      body: `:root { --brand-secondary: #f59e0b; } /* ${SENTINEL} */ body { background: #ffffff; }`,
    })
    .serve("https://static.brand.example/extra.css", { contentType: "text/css", body: "a{}" })
    .serve("https://brand.example/touch.png", { contentType: "image/png", body: logoPng() });
}

function stored(): {
  readonly logos: ReencodedLogo[];
  storeLogo(logo: ReencodedLogo): Promise<string>;
} {
  const logos: ReencodedLogo[] = [];
  return {
    logos,
    storeLogo: (logo) => {
      logos.push(logo);
      return Promise.resolve("a".repeat(64));
    },
  };
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

describe("reading a page for a theme", () => {
  it("takes no WebP logo, whatever the markup says", () => {
    const page = `<link rel="apple-touch-icon" type="image/webp" href="/a.webp"><link rel="icon" href="/b.webp">`;
    expect(scanPage(page, new URL("https://brand.example/")).logo).toBeUndefined();
  });

  it("takes the page's own stylesheets, at most two, and a raster logo the markup names", () => {
    const signals = scanPage(PAGE, new URL("https://brand.example/"));
    expect(signals.themeColor).toBe("#1D4ED8");
    expect(signals.stylesheets.map((url) => url.href)).toStrictEqual([
      "https://brand.example/site.css",
      "https://static.brand.example/extra.css",
    ]);
    expect(signals.logo?.href).toBe("https://brand.example/touch.png");
  });

  it("seeds from the theme colour, a secondary property and the root rules", () => {
    const seed = seedFrom(
      "#1d4ed8",
      ":root{--brand-secondary:#f59e0b} body{color:#111;background-color:rgb(250, 250, 250);font-family:Lexend,sans-serif}",
    );
    expect(seed).toStrictEqual({
      primary: "#1d4ed8",
      secondary: "#f59e0b",
      text: "#111111",
      background: "#fafafa",
      fontFamily: "Lexend,sans-serif",
    });
  });

  it("falls back to a primary custom property, then the most used chromatic colour", () => {
    expect(seedFrom(undefined, ".a{--color-primary: #0f766e}").primary).toBe("#0f766e");
    expect(seedFrom(undefined, ".a{color:#be123c}.b{color:#be123c}.c{color:#000}").primary).toBe(
      "#be123c",
    );
    expect(() => seedFrom(undefined, "body{color:#000;background:#fff}")).toThrow(NothingToDerive);
  });

  it("reads hex and rgb colours and nothing else", () => {
    expect(cssColor("#abc")).toBe("#aabbcc");
    expect(cssColor("#AABBCCDD")).toBe("#aabbcc");
    expect(cssColor("rgb(1 2 3 / 50%)")).toBe("#010203");
    expect(cssColor("red")).toBeUndefined();
    expect(cssColor("var(--x)")).toBeUndefined();
  });
});

describe("the derive (SEC-18 F8, M1, M2)", () => {
  it("fetches the page, each stylesheet and the logo on its own, and returns colours and enums only", async () => {
    const fetcher = fakeSite();
    const store = stored();
    const derived = await deriveTheme(
      { fetcher, codec: createLogoCodec(), storeLogo: (logo) => store.storeLogo(logo) },
      "https://brand.example/",
    );

    expect(fetcher.requests).toStrictEqual([
      { url: "https://brand.example/", kind: "page" },
      { url: "https://brand.example/site.css", kind: "stylesheet" },
      { url: "https://static.brand.example/extra.css", kind: "stylesheet" },
      { url: "https://brand.example/touch.png", kind: "logo" },
    ]);
    expect(store.logos).toHaveLength(1);
    expect(store.logos[0]?.contentType).toBe("image/png");
    expect(derived.logoKey).toBe("a".repeat(64));
    expect(derived.face).toBe("lexend");
    expect(Object.keys(derived.palettes)).toStrictEqual([...PALETTE_KINDS]);

    const faces = new Set<string>(APPEARANCE_FACES.map((face) => face.key));
    const enums = new Set<string>([...PALETTE_KINDS, ...APPEARANCE_COLOR_TOKENS, ...faces]);
    for (const value of strings(derived)) {
      expect(
        /^#[0-9a-f]{6}$/iu.test(value) || /^[0-9a-f]{64}$/u.test(value) || enums.has(value),
        value,
      ).toBe(true);
    }
    expect(JSON.stringify(derived)).not.toContain(SENTINEL);
    expect(JSON.stringify(derived)).not.toContain("Lexend");
  });

  it("is refused as a whole when the page or a stylesheet is refused", async () => {
    const deps = (fetcher: FakeBrandFetcher) => ({
      fetcher,
      codec: createLogoCodec(),
      storeLogo: () => Promise.resolve(null),
    });
    const badSheet = fakeSite().serve("https://brand.example/site.css", {
      contentType: "text/html",
      body: "<!doctype html>",
    });
    await expect(deriveTheme(deps(badSheet), "https://brand.example/")).rejects.toBeInstanceOf(
      BrandFetchRefused,
    );
    const badPage = fakeSite().serve("https://brand.example/", {
      contentType: "application/json",
      body: "{}",
    });
    await expect(deriveTheme(deps(badPage), "https://brand.example/")).rejects.toBeInstanceOf(
      BrandFetchRefused,
    );
  });

  it.each([
    [
      "a logo fetch that is refused",
      { contentType: "image/svg+xml", body: "<svg/>" },
      "content-type",
    ],
    [
      "a logo the codec refuses",
      { contentType: "image/png", body: withIhdr(logoPng(), 5000, 5000) },
      "too-many-pixels",
    ],
  ])("derives without a logo after %s", async (_name, resource, reason) => {
    const fetcher = fakeSite().serve("https://brand.example/touch.png", resource);
    const store = stored();
    const dropped: string[] = [];
    const derived = await deriveTheme(
      {
        fetcher,
        codec: createLogoCodec(),
        storeLogo: (logo) => store.storeLogo(logo),
        onLogoDropped: (why) => dropped.push(why),
      },
      "https://brand.example/",
    );
    expect(derived.logoKey).toBeNull();
    expect(store.logos).toStrictEqual([]);
    expect(dropped).toStrictEqual([reason]);
  });

  it("passes every fetch the contact hook, so each host is recorded before it is contacted", async () => {
    const fetcher = fakeSite();
    const contacted: string[] = [];
    await deriveTheme(
      {
        fetcher,
        codec: createLogoCodec(),
        storeLogo: () => Promise.resolve(null),
        beforeContact: (host) => {
          contacted.push(host);
          return Promise.resolve();
        },
      },
      "https://brand.example/",
    );
    expect(contacted).toStrictEqual([
      "brand.example",
      "brand.example",
      "static.brand.example",
      "brand.example",
    ]);
  });
});

describe("the scan is linear in what it reads (SEC-18 F6)", () => {
  const MIB = 1024 * 1024;
  const fill = (unit: string, bytes: number): string =>
    unit.repeat(Math.floor(bytes / unit.length));
  const timed = (work: () => unknown): number => {
    const started = performance.now();
    try {
      work();
    } catch (err: unknown) {
      if (!(err instanceof NothingToDerive)) throw err;
    }
    return performance.now() - started;
  };

  it.each(["<link ", "<!--", "<style>", "<meta ", "<link a=", "<link rel='", "<"])(
    "reads a 1 MiB page of %j in well under a second",
    (unit) => {
      const page = `<!doctype html>${fill(unit, MIB)}`;
      expect(timed(() => scanPage(page, new URL("https://www.brand.example/")))).toBeLessThan(1000);
    },
  );

  it.each(["rgb(", "rgba(", "{", "}", "#abc", "a{b:c;", "rgb(1,2,3)"])(
    "reads a 2 MiB stylesheet of %j in well under a second",
    (unit) => {
      const css = fill(unit, 2 * MIB);
      expect(timed(() => seedFrom(undefined, css))).toBeLessThan(1000);
    },
  );

  it("still reads the tags and colours an ordinary page holds after the hostile run", () => {
    const page = `${fill("<link ", 64 * 1024)}><meta name="theme-color" content="#0f766e">`;
    expect(scanPage(page, new URL("https://brand.example/")).themeColor).toBe("#0f766e");
    expect(seedFrom(undefined, `${fill("rgb(", 4096)}) .a{color:rgb(190, 18, 60)}`).primary).toBe(
      "#be123c",
    );
  });
});

describe("the derive output schema (SEC-18 M1)", () => {
  async function valid(): Promise<Record<string, unknown>> {
    const derived: Record<string, unknown> = await deriveTheme(
      { fetcher: fakeSite(), codec: createLogoCodec(), storeLogo: () => Promise.resolve(null) },
      "https://brand.example/",
    );
    return derived;
  }

  it("accepts what the derive produces", async () => {
    expect(DeriveResult.safeParse(await valid()).success).toBe(true);
  });

  it.each([
    ["a page title", (r: Record<string, unknown>) => ({ ...r, title: "Brand" })],
    ["alt text", (r: Record<string, unknown>) => ({ ...r, alt: "Our logo" })],
    ["a face outside the registry", (r: Record<string, unknown>) => ({ ...r, face: "Comic Sans" })],
    ["a source URL", (r: Record<string, unknown>) => ({ ...r, logoKey: "https://brand.example/" })],
    [
      "a named colour",
      (r: Record<string, unknown>) => {
        const palettes = r["palettes"] as Record<string, Record<string, string>>;
        return { ...r, palettes: { ...palettes, light: { ...palettes["light"], primary: "red" } } };
      },
    ],
    [
      "a free string inside a correction",
      (r: Record<string, unknown>) => ({
        ...r,
        corrections: [
          { palette: "light", token: "primary", from: "#000000", to: "#ffffff", why: "x" },
        ],
      }),
    ],
  ])("fails with %s", async (_name, mutate) => {
    expect(DeriveResult.safeParse(mutate(await valid())).success).toBe(false);
  });
});
