import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { IMAGES } from "./build-images.mjs";
import {
  assertScanIsAnswerable,
  atOrAbove,
  escapeCell,
  EXIT_BLOCKED,
  EXIT_OK,
  MAX_CELL_LENGTH,
  findings,
  main,
  mergeFindings,
  parseArgv,
  purlEcosystems,
  renderReport,
  reportDigest,
  severityCounts,
  severityRank,
  spdxDocument,
  summarizeImage,
} from "./image-scan.mjs";

/**
 * The image vulnerability scan (issue #894).
 *
 * No Docker and no scanner binary. Three properties are worth asserting cheaply:
 *
 * - **The decision.** Which findings a floor selects, and the rule that matters most
 *   here: the published-fix filter narrows what can turn a job red and must never
 *   narrow what a person is shown. An unfixed critical has to appear by id in the
 *   rendered report, because reporting is the only channel the Code Owner's pending
 *   decision has.
 * - **The refusals.** What stops a scan that has gone half-blind from reporting a tidy
 *   clean result.
 * - **The boundary.** Exit codes, argument parsing, and Markdown that ends up in an
 *   issue body built out of package names nobody in this repository controls.
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
 * The SBOM fixture, in the shape syft writes through `docker/buildkit-syft-scanner`:
 * one npm package and one deb package, the deb one carrying the `distro=` qualifier
 * that is how the operating-system half of the scan stays possible at all once the
 * image itself is out of reach.
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
 * The report fixture.
 *
 * `distro` and `descriptor` are copied from a real `grype 0.119.0 --output json` run
 * over the `qcms-api` SBOM and trimmed: the real `descriptor.db.providers` map carries
 * about thirty entries and `descriptor.configuration` the whole resolved config. The
 * `db.status` nesting is the part that matters, because a fixture with `built` at the
 * top of `db` would satisfy a presence check and say nothing about the real report.
 *
 * The matches are the three cases the floors have to tell apart: a critical with no fix
 * anywhere (the base image's real situation), a high with a fix, and a medium with one.
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
  distro: { name: "debian", version: "12.15", idLike: [] },
  descriptor: {
    name: "grype",
    version: "0.119.0",
    db: {
      status: {
        schemaVersion: "v6.1.9",
        built: "2026-09-18T06:30:15Z",
        // The real report carries an absolute cache path here; a placeholder stands in
        // it, because a committed fixture never hard-codes one machine's home.
        path: "<cache-dir>/grype/db/6/vulnerability.db",
        valid: true,
      },
      providers: { debian: { captured: "2026-09-18T00:31:49Z", input: "xxh64:de3468208f484970" } },
    },
  },
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

  it("leaves a critical with no available fix out of the blocking set by default", () => {
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
    ).toThrow(/no vulnerability database build date/);
  });

  it("refuses a database the scanner itself reports as invalid", () => {
    const invalid = {
      ...REPORT,
      descriptor: {
        ...REPORT.descriptor,
        db: { ...REPORT.descriptor.db, status: { ...REPORT.descriptor.db.status, valid: false } },
      },
    };
    expect(() => assertScanIsAnswerable({ image, document: STATEMENT, report: invalid })).toThrow(
      /reports as invalid/,
    );
  });

  it("refuses an npm-only report over an SBOM that carries deb packages", () => {
    expect(() =>
      assertScanIsAnswerable({ image, document: STATEMENT, report: { ...REPORT, distro: null } }),
    ).toThrow(/names no distro/);
  });
});

describe("the two axes are decoupled", () => {
  const summary = summarizeImage(
    { image: "qcms-api", document: STATEMENT, report: REPORT },
    FLOORS,
  );

  it("keeps the published-fix filter on blocking and not on reporting", () => {
    expect(summary.blocking).toEqual([]);
    expect(summary.reportedFixable.map((finding) => finding.id)).toEqual(["GHSA-rgw5-rvv9-x895"]);
    expect(summary.reportedUnfixed.map((finding) => finding.id)).toEqual(["CVE-2026-5450"]);
  });

  it("NAMES an unfixed critical by id in the rendered report", () => {
    // The property this section exists for. An unfixed critical cannot turn a job red,
    // so if it is not named here it reaches nobody, and an eighth one next week would
    // move a digit in a counts table and change nothing else.
    const markdown = renderReport([summary], FLOORS);
    expect(markdown).toContain("CVE-2026-5450");
    expect(markdown).toContain("NO FIX AVAILABLE");
    expect(markdown).toMatch(/NO FIX AVAILABLE[\s\S]*?CVE-2026-5450[\s\S]*?wont-fix/);
    // ...and it is still not in the blocking section.
    expect(markdown).toMatch(/### Blocking:[\s\S]*?None\./);
  });

  it("summarises the image and keeps every finding in the counts", () => {
    expect(summary.packages).toBe(3);
    expect(summary.distro).toBe("debian 12.15");
    expect(summary.unfixed).toBe(1);
    expect(summary.counts.critical).toBe(1);
  });

  it("renders the fixed version and the triage pointer", () => {
    const markdown = renderReport([summary], FLOORS);
    expect(markdown).toContain("GHSA-rgw5-rvv9-x895");
    expect(markdown).toContain("5.0.9");
    expect(markdown).toContain("Security overrides");
  });

  it("moves an unfixed critical into the blocking section under --fail-on-unfixed", () => {
    const widened = { ...FLOORS, failOnUnfixed: true };
    const markdown = renderReport(
      [summarizeImage({ image: "qcms-api", document: STATEMENT, report: REPORT }, widened)],
      widened,
    );
    expect(markdown).toMatch(/### Blocking:[\s\S]*?CVE-2026-5450/);
    // Reporting is unchanged by the flag: the finding is named in both places.
    expect(markdown).toMatch(/NO FIX AVAILABLE[\s\S]*?CVE-2026-5450/);
  });
});

describe("merging the three images into one listing", () => {
  const summaries = ["qcms-api", "qcms-portal", "qcms-admin"].map((image) =>
    summarizeImage({ image, document: STATEMENT, report: REPORT }, FLOORS),
  );

  it("collapses the same base-image finding into one row naming every image", () => {
    const rows = mergeFindings(summaries, "reportedUnfixed");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("CVE-2026-5450");
    expect(rows[0].images).toEqual(["qcms-api", "qcms-portal", "qcms-admin"]);
  });

  it("keeps a finding that only one image carries distinct", () => {
    const extra = {
      ...REPORT,
      matches: [
        ...REPORT.matches,
        match("CVE-2026-9999", "High", "npm", "only-here", "1.0.0", {
          state: "wont-fix",
          versions: [],
        }),
      ],
    };
    const mixed = [
      summarizeImage({ image: "qcms-api", document: STATEMENT, report: extra }, FLOORS),
      summarizeImage({ image: "qcms-portal", document: STATEMENT, report: REPORT }, FLOORS),
    ];
    const rows = mergeFindings(mixed, "reportedUnfixed");
    expect(rows.find((row) => row.id === "CVE-2026-9999")?.images).toEqual(["qcms-api"]);
  });
});

describe("the digest that decides whether the weekly issue changes", () => {
  const summaries = [
    summarizeImage({ image: "qcms-api", document: STATEMENT, report: REPORT }, FLOORS),
  ];

  it("is stable for the same finding set", () => {
    expect(reportDigest(summaries)).toBe(reportDigest(summaries));
  });

  it("does not move when the same findings arrive in a different order", () => {
    // The silence depends on this. If the digest tracked the scanner's ordering, a
    // week in which nothing changed but the match order did would post a duplicate,
    // and people would stop reading a thread that cries wolf.
    const reversed = { ...REPORT, matches: [...REPORT.matches].reverse() };
    const after = [
      summarizeImage({ image: "qcms-api", document: STATEMENT, report: reversed }, FLOORS),
    ];
    expect(reportDigest(after)).toBe(reportDigest(summaries));
  });

  it("does not move when the images are listed in a different order", () => {
    const order = ["qcms-api", "qcms-portal", "qcms-admin"].map((image) =>
      summarizeImage({ image, document: STATEMENT, report: REPORT }, FLOORS),
    );
    expect(reportDigest([...order].reverse())).toBe(reportDigest(order));
  });

  it("moves when a finding gains a fix, which is a real change of answer", () => {
    const fixed = {
      ...REPORT,
      matches: REPORT.matches.map((entry) =>
        entry.vulnerability.id === "CVE-2026-5450"
          ? match("CVE-2026-5450", "Critical", "deb", "libc6", "2.36-9+deb12u14", {
              state: "fixed",
              versions: ["2.36-9+deb12u15"],
            })
          : entry,
      ),
    };
    const after = [
      summarizeImage({ image: "qcms-api", document: STATEMENT, report: fixed }, FLOORS),
    ];
    expect(reportDigest(after)).not.toBe(reportDigest(summaries));
  });

  it("does not move for a change below the reporting floor", () => {
    const noisier = {
      ...REPORT,
      matches: [
        ...REPORT.matches,
        match("GHSA-0000-low", "Low", "npm", "something", "1.0.0", {
          state: "fixed",
          versions: ["1.0.1"],
        }),
      ],
    };
    const after = [
      summarizeImage({ image: "qcms-api", document: STATEMENT, report: noisier }, FLOORS),
    ];
    expect(reportDigest(after)).toBe(reportDigest(summaries));
  });

  it("moves when one more unfixed critical appears", () => {
    const worse = {
      ...REPORT,
      matches: [
        ...REPORT.matches,
        match("CVE-2026-0002", "Critical", "deb", "perl-base", "5.36.0-7+deb12u3", {
          state: "not-fixed",
          versions: [],
        }),
      ],
    };
    const after = [
      summarizeImage({ image: "qcms-api", document: STATEMENT, report: worse }, FLOORS),
    ];
    expect(reportDigest(after)).not.toBe(reportDigest(summaries));
  });
});

describe("Markdown that ends up in an issue body", () => {
  it("neutralises a pipe, a newline, a heading, a mention and a link", () => {
    expect(escapeCell("a|b")).toBe("`a\\|b`");
    expect(escapeCell("one\ntwo")).toBe("`one two`");
    expect(escapeCell("# heading")).toBe("`# heading`");
    expect(escapeCell("@roonga")).toBe("`@roonga`");
    expect(escapeCell("[x](https://example.invalid)")).toBe("`[x](https://example.invalid)`");
    // A backtick would close the span that does the neutralising.
    expect(escapeCell("a`b")).toBe("`a'b`");
    expect(escapeCell("")).toBe("``");
  });

  it("caps a cell so the issue body's byte cut cannot land inside a code span", () => {
    const long = escapeCell("x".repeat(5_000));
    expect(long.length).toBeLessThanOrEqual(MAX_CELL_LENGTH + 2);
    expect(long.startsWith("`")).toBe(true);
    expect(long.endsWith("...`")).toBe(true);
    expect(long.match(/`/g)).toHaveLength(2);
  });

  it("never cuts a capped cell on a lone backslash, which would escape the fence", () => {
    // Every character escapes to two, so the cut lands mid-escape unless it is moved.
    const piped = escapeCell("|".repeat(5_000));
    expect(piped.match(/`/g)).toHaveLength(2);
    expect(piped.endsWith("|...`")).toBe(true);
    // No odd run of backslashes immediately before the closing fence.
    expect(piped).not.toMatch(/(^|[^\\])(\\\\)*\\\.\.\.`$/);
  });

  it("keeps a crafted package name inside one table cell", () => {
    const crafted = {
      ...REPORT,
      matches: [
        match(
          "CVE-2026-0003",
          "Critical",
          "npm",
          "evil | a\\|b ## pwned\n@roonga [click](https://example.invalid)",
          "1.0.0",
          { state: "wont-fix", versions: [] },
        ),
      ],
    };
    const markdown = renderReport(
      [summarizeImage({ image: "qcms-api", document: STATEMENT, report: crafted }, FLOORS)],
      FLOORS,
    );
    const row = markdown.split("\n").find((line) => line.includes("CVE-2026-0003"));
    expect(row).toBeDefined();
    // Seven unescaped pipes: six columns with a leading and a trailing delimiter. The
    // injected pipe is escaped rather than opening a seventh cell.
    //
    // Counted by removing every backslash escape first rather than with a lookbehind.
    // `/(?<!\\)\|/` asks "is the previous character a backslash", which a name
    // containing a literal `\|` defeats: it escapes to `\\|`, the lookbehind sees the
    // second backslash and calls the pipe unescaped. Dropping `\\.` pairs leaves only
    // the delimiters, whatever the cell contained.
    expect(row?.replace(/\\./g, "").split("|")).toHaveLength(8);
    // No newline escaped out of the cell, so no heading was injected.
    expect(markdown).not.toMatch(/^## pwned/m);
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

  /** A stub that fails the way a missing database or a broken binary would. */
  function brokenScanner(root: string): string {
    const path = join(root, "broken-scanner.mjs");
    writeFileSync(
      path,
      `#!/usr/bin/env node\nprocess.stderr.write("could not fetch vulnerability database\\n");\nprocess.exit(1);\n`,
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

  it("scans every image, writes both summaries, and exits clean when nothing blocks", () => {
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

    expect(code).toBe(EXIT_OK);
    const summary: {
      blocking: number;
      reported: number;
      reportedUnfixed: number;
      digest: string;
      images: { image: string }[];
    } = JSON.parse(readFileSync(join(reportRoot, "summary.json"), "utf8"));
    expect(summary.images.map((entry) => entry.image)).toEqual(IMAGES.map((image) => image.name));
    expect(summary.blocking).toBe(0);
    // Merged across the three images, so one row each rather than three.
    expect(summary.reported).toBe(1);
    expect(summary.reportedUnfixed).toBe(1);
    expect(summary.digest).toMatch(/^[0-9a-f]{64}$/);
    const markdown = readFileSync(join(reportRoot, "summary.md"), "utf8");
    expect(markdown).toContain("## Image vulnerability scan");
    // The unfixed critical reaches the file a person reads, not only the artifact.
    expect(markdown).toContain("CVE-2026-5450");
  });

  it("exits with the blocking code when a finding at the blocking floor has a published fix", () => {
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
    ).toBe(EXIT_BLOCKED);
  });

  it("blocks on an unfixed finding only when --fail-on-unfixed is given", () => {
    const root = scratch();
    const argv = [
      "--attestations",
      attestations(root),
      "--report",
      join(root, "report"),
      "--scanner",
      stubScanner(root, REPORT),
      "--quiet",
    ];
    expect(main(argv, {})).toBe(EXIT_OK);
    expect(main([...argv, "--fail-on-unfixed"], {})).toBe(EXIT_BLOCKED);
    // ...and through the environment, which is how the workflow would move it.
    expect(main(argv, { QCMS_IMAGE_SCAN_FAIL_ON_UNFIXED: "true" })).toBe(EXIT_BLOCKED);
  });

  it("throws rather than returning a verdict when the scanner itself fails", () => {
    const root = scratch();
    // A throw, never EXIT_BLOCKED: a broken scanner is not a statement about the images.
    expect(() =>
      main(
        [
          "--attestations",
          attestations(root),
          "--report",
          join(root, "report"),
          "--scanner",
          brokenScanner(root),
          "--quiet",
        ],
        {},
      ),
    ).toThrow();
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
