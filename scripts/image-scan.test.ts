import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { IMAGES } from "./build-images.mjs";
import {
  assertScanIsAnswerable,
  atOrAbove,
  findings,
  main,
  parseArgv,
  purlEcosystems,
  renderReport,
  severityCounts,
  severityRank,
  spdxDocument,
  summarizeImage,
} from "./image-scan.mjs";

/**
 * The image vulnerability scan (issue #894).
 *
 * No Docker and no scanner binary: the two halves worth asserting cheaply are the
 * **decision** - which findings a floor selects, and the fact that an unfixable one
 * cannot turn a job red - and the **refusals**, which are what stop a scan that has
 * gone half-blind from reporting a tidy clean result. The end-to-end path is covered
 * too, with a stub scanner standing in for grype, so the argument vector this script
 * passes and the exit code it returns are both exercised.
 *
 * The real scan over the real SBOMs is what `.github/workflows/images.yml` runs.
 */

const temporary: string[] = [];

afterAll(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
});

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "qcms-image-scan-"));
  temporary.push(root);
  return root;
}

/** An SPDX package entry in the shape syft writes, purl and all. */
function spdxPackage(purl: string, name: string, version: string) {
  return {
    name,
    versionInfo: version,
    externalRefs: [
      {
        referenceCategory: "SECURITY",
        referenceType: "cpe23Type",
        referenceLocator: `cpe:2.3:a:${name}:${name}:${version}:*:*:*:*:*:*:*`,
      },
      { referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: purl },
    ],
  };
}

/**
 * The SBOM fixture: one npm package and one deb package, the deb one carrying the
 * `distro=` qualifier that is how the operating-system half of the scan stays possible
 * at all once the image itself is out of reach.
 */
const SBOM = {
  spdxVersion: "SPDX-2.3",
  name: "sbom",
  packages: [
    spdxPackage("pkg:npm/%40roonga/qcms-core@1.0.0", "@roonga/qcms-core", "1.0.0"),
    spdxPackage("pkg:npm/brace-expansion@5.0.7", "brace-expansion", "5.0.7"),
    spdxPackage(
      "pkg:deb/debian/libc6@2.36-9+deb12u14?arch=amd64&distro=debian-12.15",
      "libc6",
      "2.36-9+deb12u14",
    ),
    // No purl at all: an SPDX file entry, which must not be counted as a package.
    { name: "a-file", versionInfo: "", externalRefs: [] },
  ],
};

/** The in-toto statement buildx attaches, whose predicate is the document above. */
const STATEMENT = { _type: "https://in-toto.io/Statement/v0.1", predicate: SBOM };

function match(
  id: string,
  severity: string,
  type: string,
  name: string,
  version: string,
  fix: { state: string; versions: string[] },
) {
  return {
    vulnerability: { id, severity, fix },
    artifact: { type, name, version },
  };
}

/**
 * The report fixture: one critical with no fix (the base image's real situation), one
 * high with a fix, one medium with a fix.
 */
const REPORT = {
  matches: [
    match("CVE-2026-5450", "Critical", "deb", "libc6", "2.36-9+deb12u14", {
      state: "wont-fix",
      versions: [],
    }),
    match("GHSA-rgw5-rvv9-x895", "High", "npm", "brace-expansion", "5.0.7", {
      state: "fixed",
      versions: ["5.0.9"],
    }),
    match("GHSA-0000-medium", "Medium", "npm", "brace-expansion", "5.0.7", {
      state: "fixed",
      versions: ["5.0.9"],
    }),
  ],
  distro: { name: "debian", version: "12.15", idLike: ["debian"] },
  descriptor: { name: "grype", version: "0.119.0", db: { built: "2026-09-18T06:30:15Z" } },
};

const FLOORS = { failOn: "critical", notifyOn: "high", failOnUnfixed: false };

describe("severity ladder", () => {
  it("ranks case-insensitively, lowest rung first", () => {
    expect(severityRank("Critical")).toBeGreaterThan(severityRank("high"));
    expect(severityRank("unknown")).toBe(0);
  });

  it("refuses a severity it does not know rather than sorting it below every floor", () => {
    expect(() => severityRank("Catastrophic")).toThrow(/unknown severity/);
  });
});

describe("reading the SBOM", () => {
  it("unwraps the in-toto statement and passes a bare document through", () => {
    expect(spdxDocument(STATEMENT)).toBe(SBOM);
    expect(spdxDocument(SBOM)).toBe(SBOM);
  });

  it("counts packages by purl ecosystem and ignores an entry with no purl", () => {
    expect(purlEcosystems(STATEMENT)).toEqual({ npm: 2, deb: 1 });
  });
});

describe("what a floor selects", () => {
  it("counts every severity, including the rungs nothing reached", () => {
    expect(severityCounts(findings(REPORT))).toEqual({
      unknown: 0,
      negligible: 0,
      low: 0,
      medium: 1,
      high: 1,
      critical: 1,
    });
  });

  it("leaves an unfixable critical out of the blocking set by default", () => {
    expect(atOrAbove(findings(REPORT), "critical", false)).toEqual([]);
  });

  it("includes it when the run is asked to fail on findings with no fix", () => {
    expect(atOrAbove(findings(REPORT), "critical", true).map((finding) => finding.id)).toEqual([
      "CVE-2026-5450",
    ]);
  });

  it("selects at or above the floor, not only at it", () => {
    const ids = atOrAbove(findings(REPORT), "medium", true).map((finding) => finding.id);
    expect(ids).toEqual(["CVE-2026-5450", "GHSA-rgw5-rvv9-x895", "GHSA-0000-medium"]);
  });
});

describe("refusing a scan that cannot answer the question", () => {
  const image = "qcms-api";

  it("accepts the matching pair", () => {
    expect(() =>
      assertScanIsAnswerable({ image, document: STATEMENT, report: REPORT }),
    ).not.toThrow();
  });

  it("refuses an SBOM with no purls at all", () => {
    expect(() =>
      assertScanIsAnswerable({
        image,
        document: { packages: [{ name: "a-file", externalRefs: [] }] },
        report: REPORT,
      }),
    ).toThrow(/no packages with a purl/);
  });

  it("refuses a report produced without a vulnerability database", () => {
    expect(() =>
      assertScanIsAnswerable({
        image,
        document: STATEMENT,
        report: { ...REPORT, descriptor: { name: "grype" } },
      }),
    ).toThrow(/no vulnerability database/);
  });

  it("refuses an npm-only report over an SBOM that carries deb packages", () => {
    expect(() =>
      assertScanIsAnswerable({ image, document: STATEMENT, report: { ...REPORT, distro: null } }),
    ).toThrow(/names no distro/);
  });
});

describe("the report", () => {
  const summary = summarizeImage({ image: "qcms-api", document: STATEMENT, report: REPORT }, FLOORS);

  it("summarises the image without counting the unfixable critical as blocking", () => {
    expect(summary.packages).toBe(3);
    expect(summary.distro).toBe("debian 12.15");
    expect(summary.unfixed).toBe(1);
    expect(summary.blocking).toEqual([]);
    expect(summary.notifying.map((finding) => finding.id)).toEqual(["GHSA-rgw5-rvv9-x895"]);
  });

  it("renders a summary table, the fixed version, and the triage pointer", () => {
    const markdown = renderReport([summary], FLOORS);
    expect(markdown).toContain("| qcms-api | debian 12.15 | 3 |");
    expect(markdown).toContain("GHSA-rgw5-rvv9-x895");
    expect(markdown).toContain("5.0.9");
    expect(markdown).toContain("Security overrides");
    // The unfixable critical is recorded in the counts and absent from the blocking list.
    expect(markdown).toMatch(/### Blocking: at or above `critical`[\s\S]*?None\./);
  });
});

describe("the argument vector", () => {
  it("defaults both floors and reads them from the environment", () => {
    expect(parseArgv([], {}).failOn).toBe("critical");
    expect(parseArgv([], {}).notifyOn).toBe("high");
    expect(parseArgv([], { QCMS_IMAGE_SCAN_FAIL_ON: "high" }).failOn).toBe("high");
    expect(parseArgv(["--fail-on", "medium"], { QCMS_IMAGE_SCAN_FAIL_ON: "high" }).failOn).toBe(
      "medium",
    );
  });

  it("refuses a floor that is not a severity, instead of never matching one", () => {
    expect(() => parseArgv(["--notify-on", "urgent"], {})).toThrow(/unknown severity/);
  });
});

describe("end to end, with a stub scanner", () => {
  /** A stub grype: reads `--file` out of its argv and writes the fixture report there. */
  function stubScanner(root: string, report: unknown): string {
    const path = join(root, "stub-scanner.mjs");
    writeFileSync(
      path,
      `#!/usr/bin/env node\n` +
        `import { writeFileSync } from "node:fs";\n` +
        `const argv = process.argv.slice(2);\n` +
        `if (!argv[0].startsWith("sbom:")) { process.exit(2); }\n` +
        `writeFileSync(argv[argv.indexOf("--file") + 1], ${JSON.stringify(JSON.stringify(report))});\n`,
    );
    chmodSync(path, 0o755);
    return path;
  }

  function attestations(root: string): string {
    const attestationRoot = join(root, "attestations");
    for (const image of IMAGES) {
      mkdirSync(join(attestationRoot, image.name), { recursive: true });
      writeFileSync(
        join(attestationRoot, image.name, "spdx.dev-Document.json"),
        JSON.stringify(STATEMENT),
      );
    }
    return attestationRoot;
  }

  it("scans every image, writes both summaries, and exits 0 when nothing blocks", () => {
    const root = scratch();
    const reportRoot = join(root, "report");
    const code = main(
      [
        "--attestations",
        attestations(root),
        "--report",
        reportRoot,
        "--scanner",
        stubScanner(root, REPORT),
        "--quiet",
      ],
      {},
    );

    expect(code).toBe(0);
    const summary: {
      blocking: number;
      notifying: number;
      images: { image: string }[];
    } = JSON.parse(readFileSync(join(reportRoot, "summary.json"), "utf8"));
    expect(summary.images.map((entry) => entry.image)).toEqual(IMAGES.map((image) => image.name));
    expect(summary.blocking).toBe(0);
    // One reportable high per image, which is what the scheduled run files an issue on.
    expect(summary.notifying).toBe(IMAGES.length);
    expect(readFileSync(join(reportRoot, "summary.md"), "utf8")).toContain(
      "## Image vulnerability scan",
    );
  });

  it("exits 1 when a finding at the blocking floor has a published fix", () => {
    const root = scratch();
    const fixable = {
      ...REPORT,
      matches: [
        match("CVE-2026-0001", "Critical", "npm", "brace-expansion", "5.0.7", {
          state: "fixed",
          versions: ["5.0.9"],
        }),
      ],
    };
    expect(
      main(
        [
          "--attestations",
          attestations(root),
          "--report",
          join(root, "report"),
          "--scanner",
          stubScanner(root, fixable),
          "--quiet",
        ],
        {},
      ),
    ).toBe(1);
  });

  it("refuses a missing SBOM rather than reporting an image as clean", () => {
    const root = scratch();
    expect(() =>
      main(
        [
          "--attestations",
          join(root, "empty"),
          "--report",
          join(root, "report"),
          "--scanner",
          stubScanner(root, REPORT),
          "--quiet",
        ],
        {},
      ),
    ).toThrow(/has no persisted SBOM/);
  });
});
