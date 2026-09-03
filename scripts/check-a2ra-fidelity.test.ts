import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  compare,
  installedComponents,
  sha256,
  upstreamPin,
  vendoredFiles,
} from "./check-a2ra-fidelity.mjs";

/**
 * Tests for the ADR-22 vendoring fidelity gate (issue #189).
 *
 * The scan itself is the `check:a2ra-fidelity` step; these cover the helpers and, more
 * importantly, the failure directions. A fidelity gate that could only report OK would
 * be worse than none, because the reviewers this exists for would trust it.
 */

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The manifest as committed, which is also the fixture for the comparison tests. */
const manifest = JSON.parse(
  readFileSync(join(REPO_ROOT, "packages/ui/a2ra-manifest.json"), "utf8"),
) as {
  pin: string;
  componentsDir: string;
  components: string[];
  files: { path: string; sha256: string; origin: string }[];
};

describe("upstreamPin", () => {
  it("reads the owner, repo and commit out of the pinned registry URL", () => {
    const pin = upstreamPin(readFileSync(join(REPO_ROOT, "packages/ui/a2ra.json"), "utf8"));
    expect(pin.owner).toBe("roonga");
    expect(pin.repo).toBe("a2-react-aria");
    expect(pin.pin).toMatch(/^[0-9a-f]{40}$/);
    expect(pin.componentsDir).toBe("src/components/a2ui");
  });

  it("refuses a registry URL that is not pinned to a full commit sha", () => {
    // ADR-22 requires an immutable pin. A branch or tag name would leave the gate unable
    // to say which upstream it checked, which is the failure it exists to prevent.
    const branch = JSON.stringify({
      componentsDir: "src/components/a2ui",
      registry: "https://raw.githubusercontent.com/roonga/a2-react-aria/main/registry",
    });
    expect(() => upstreamPin(branch)).toThrow(/immutable pin|40-character/);
  });

  it("refuses a config missing either field", () => {
    expect(() => upstreamPin(JSON.stringify({ componentsDir: "x" }))).toThrow(TypeError);
  });
});

describe("installedComponents", () => {
  it("derives the component set from the tree rather than from a list", () => {
    expect(installedComponents(["alert/Alert.tsx", "alert/index.ts", "button/Button.tsx"])).toEqual(
      ["alert", "button"],
    );
  });

  it("ignores a file at the root of the vendored tree, which belongs to no component", () => {
    expect(installedComponents(["group-schema-fields.ts", "alert/Alert.tsx"])).toEqual(["alert"]);
  });
});

describe("compare", () => {
  const entry = { path: "alert/Alert.tsx", sha256: sha256("upstream"), origin: "registry:alert" };
  const fixture = { files: [entry] };

  it("passes a tree whose bytes match", () => {
    const actual = new Map([[entry.path, entry.sha256]]);
    expect(compare(fixture, actual)).toEqual({ changed: [], missing: [], extra: [] });
  });

  it("reports a single changed byte", () => {
    // The negative control, as a unit: one appended newline is a different hash.
    const actual = new Map([[entry.path, sha256("upstream\n")]]);
    const result = compare(fixture, actual);
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]).toContain(entry.path);
    expect(result.missing).toEqual([]);
  });

  it("reports a file upstream has and the tree does not", () => {
    expect(compare(fixture, new Map()).missing).toEqual([entry.path]);
  });

  it("reports local source smuggled into a tree ADR-22 says is upstream's", () => {
    const actual = new Map([
      [entry.path, entry.sha256],
      ["stray.ts", sha256("export const x = 1")],
    ]);
    expect(compare(fixture, actual).extra).toEqual(["stray.ts"]);
  });
});

describe("the committed manifest", () => {
  it("is generated for the pin a2ra.json names", () => {
    // The staleness direction: a pin move that leaves the manifest behind must be red,
    // because a manifest from another commit says nothing about this one.
    const pin = upstreamPin(readFileSync(join(REPO_ROOT, "packages/ui/a2ra.json"), "utf8"));
    expect(manifest.pin).toBe(pin.pin);
    expect(manifest.componentsDir).toBe(`packages/ui/${pin.componentsDir}`);
  });

  it("accounts for every tracked file in the vendored tree, and nothing else", () => {
    const tracked = vendoredFiles(join(REPO_ROOT, manifest.componentsDir));
    expect(manifest.files.map((file) => file.path).sort()).toEqual([...tracked].sort());
    expect(tracked.length).toBeGreaterThan(0);
  });

  it("records where each file came from, so an entry can be re-derived", () => {
    for (const file of manifest.files) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.origin).toMatch(/^(registry:[a-z0-9-]+|repo:.+)$/);
    }
  });

  it("matches the working tree byte for byte", () => {
    // The gate's own assertion, run here too so a drift fails `pnpm test` and not only
    // `pnpm check:all`.
    const root = join(REPO_ROOT, manifest.componentsDir);
    for (const file of manifest.files) {
      expect(sha256(readFileSync(join(root, file.path), "utf8")), file.path).toBe(file.sha256);
    }
  });
});
