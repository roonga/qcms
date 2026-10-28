import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  assertArtifact,
  assertNoDevPackages,
  attestationFileName,
  attestationManifestCount,
  buildArgv,
  IMAGES,
  imageReferences,
  imageTag,
  imageVersion,
  inspectOciArtifact,
  parseArgv,
  PROVENANCE_PREDICATE,
  REGISTRY,
  saveAttestations,
  SPDX_PREDICATE,
  VERSION_LABEL,
} from "./build-images.mjs";

/**
 * No image is built here: `.github/workflows/images.yml` runs the real build and calls
 * the same `assertArtifact`. The OCI layout is hand-built rather than recorded because
 * a real export is 200MB of layers for three JSON documents.
 */

const workspaces: string[] = [];

afterAll(() => {
  for (const directory of workspaces) rmSync(directory, { recursive: true, force: true });
});

function ociArtifact(
  predicates: string[],
  labels: Record<string, string>,
  sbomPackages: string[] = ["hono@4.13.7"],
): string {
  const root = mkdtempSync(join(tmpdir(), "qcms-oci-"));
  workspaces.push(root);
  const blobs = join(root, "blobs", "sha256");
  mkdirSync(blobs, { recursive: true });

  let next = 0;
  const put = (value: unknown): string => {
    // Digests are opaque to the traversal: it follows them, it does not verify them.
    const digest = `${String(next++).padStart(64, "0")}`;
    const file = join(blobs, digest);
    writeFileSync(file, JSON.stringify(value));
    // Read-only as buildx writes it: `copyFileSync` inherits the mode, so a second
    // export into one directory fails with EACCES unless the destination is removed.
    chmodSync(file, 0o444);
    return `sha256:${digest}`;
  };

  const configDigest = put({ config: { Labels: labels } });
  const imageDigest = put({ config: { digest: configDigest }, layers: [] });
  const attestationDigest = put({
    layers: predicates.map((predicate) => ({
      mediaType: "application/vnd.in-toto+json",
      // A real in-toto layer points at a blob holding the statement, and the export path
      // copies that blob, so the fixture has to carry one.
      digest: put({
        _type: "https://in-toto.io/Statement/v1",
        predicateType: predicate,
        // Only the SBOM predicate carries a body anything reads, and the purl is where the
        // package name comes from.
        ...(predicate === SPDX_PREDICATE
          ? {
              predicate: {
                packages: sbomPackages.map((reference) => ({
                  name: reference.slice(0, reference.lastIndexOf("@")),
                  externalRefs: [
                    {
                      referenceCategory: "PACKAGE-MANAGER",
                      referenceType: "purl",
                      referenceLocator: `pkg:npm/${reference.replace(/^@/, "%40")}`,
                    },
                  ],
                })),
              },
            }
          : {}),
      }),
      annotations: { "in-toto.io/predicate-type": predicate },
    })),
  });
  const listDigest = put({
    manifests: [
      { digest: imageDigest, platform: { architecture: "amd64", os: "linux" } },
      { digest: attestationDigest, platform: { architecture: "unknown", os: "unknown" } },
    ],
  });
  writeFileSync(join(root, "index.json"), JSON.stringify({ manifests: [{ digest: listDigest }] }));
  return root;
}

const BOTH = [SPDX_PREDICATE, PROVENANCE_PREDICATE];

describe("version derivation", () => {
  it("prefers an explicit QCMS_IMAGE_VERSION", () => {
    expect(imageVersion({ QCMS_IMAGE_VERSION: "1.2.3" })).toBe("1.2.3");
  });

  it("falls back to the workspace version plus the commit", () => {
    // An unset variable and one set to "" reach a shell script identically, so "" must
    // not stamp an image with the empty string.
    const derived = imageVersion({ QCMS_IMAGE_VERSION: "" });
    expect(derived).toMatch(/^\d+\.\d+\.\d+[^+]*\+[0-9a-f]{7,}(\.dirty)?$/);
  });

  it("makes the version legal as a Docker tag without losing the commit", () => {
    // `+` is valid SemVer build metadata and illegal in an image reference.
    expect(imageTag("0.0.1-alpha.0+83fa947")).toBe("0.0.1-alpha.0_83fa947");
    expect(imageTag("0.0.1-alpha.0+83fa947")).toMatch(/^\w[\w.-]{0,127}$/);
  });

  it("gives two different versions two different tags", () => {
    // `_` and not `-`: `-` is legal in a SemVer version, so `1.0.0+build.5` and
    // `1.0.0-build.5` would collide on one tag.
    expect(imageTag("1.0.0+build.5")).not.toBe(imageTag("1.0.0-build.5"));
    expect(imageTag("1.0.0-build.5")).toBe("1.0.0-build.5");
    for (const version of ["1.0.0+build.5", "1.0.0-build.5", "0.0.1-alpha.0+83fa947.dirty"]) {
      expect(imageTag(version)).toMatch(/^\w[\w.-]{0,127}$/);
    }
  });
});

describe("OCI artifact traversal", () => {
  it("finds both attestations and the version label", () => {
    const artifact = ociArtifact(BOTH, { [VERSION_LABEL]: "1.2.3" });
    const { labels, predicates } = inspectOciArtifact(artifact);
    expect(predicates.sort()).toEqual([...BOTH].sort());
    expect(labels[VERSION_LABEL]).toBe("1.2.3");
  });

  it("passes a well-formed artifact", () => {
    const artifact = ociArtifact(BOTH, { [VERSION_LABEL]: "1.2.3" });
    expect(() => assertArtifact(artifact, "1.2.3", "qcms-api")).not.toThrow();
  });

  it("rejects an artifact with no SBOM", () => {
    const artifact = ociArtifact([PROVENANCE_PREDICATE], { [VERSION_LABEL]: "1.2.3" });
    expect(() => assertArtifact(artifact, "1.2.3", "qcms-api")).toThrow(/no SBOM/);
  });

  it("rejects an artifact with no provenance", () => {
    const artifact = ociArtifact([SPDX_PREDICATE], { [VERSION_LABEL]: "1.2.3" });
    expect(() => assertArtifact(artifact, "1.2.3", "qcms-api")).toThrow(/no provenance/);
  });

  it("rejects the unstamped Dockerfile default, which is the bug it exists to catch", () => {
    const artifact = ociArtifact(BOTH, { [VERSION_LABEL]: "dev" });
    expect(() => assertArtifact(artifact, "1.2.3", "qcms-api")).toThrow(/expected/);
  });

  it("rejects a stamp that does not match what was requested", () => {
    const artifact = ociArtifact(BOTH, { [VERSION_LABEL]: "9.9.9" });
    expect(() => assertArtifact(artifact, "1.2.3", "qcms-api")).toThrow(/9\.9\.9/);
  });
});

describe("the dev-dependency boundary (issue #877)", () => {
  it("passes an image whose SBOM lists production packages only", () => {
    const artifact = ociArtifact(BOTH, { [VERSION_LABEL]: "1.2.3" }, ["hono@4.13.7", "pg@8.23.0"]);
    expect(assertNoDevPackages(artifact, "qcms-api")).toBe(2);
  });

  it("fails the build on the tooling the API image was found carrying", () => {
    // These three were in the qcms-api SBOM before the `--no-optional` deploy boundary.
    const artifact = ociArtifact(BOTH, { [VERSION_LABEL]: "1.2.3" }, [
      "hono@4.13.7",
      "vitest@4.1.11",
      "@playwright/test@1.63.0",
      "testcontainers@12.1.0",
    ]);
    expect(() => assertNoDevPackages(artifact, "qcms-api")).toThrow(/devDependency/);
    expect(() => assertNoDevPackages(artifact, "qcms-api")).toThrow(/vitest@4\.1\.11/);
  });

  it("cannot read an SBOM that is not there", () => {
    const artifact = ociArtifact([PROVENANCE_PREDICATE], { [VERSION_LABEL]: "1.2.3" });
    expect(() => assertNoDevPackages(artifact, "qcms-api")).toThrow(/no SBOM/);
  });
});

describe("the image set", () => {
  it("covers exactly the three published images", () => {
    expect(IMAGES.map((image) => image.name).sort()).toEqual([
      "qcms-admin",
      "qcms-api",
      "qcms-portal",
    ]);
  });
});

describe("registry references", () => {
  it("names every tag under the registry and namespace", () => {
    expect(imageReferences("roonga", "qcms-api", ["abc123", "latest"])).toEqual([
      `${REGISTRY}/roonga/qcms-api:abc123`,
      `${REGISTRY}/roonga/qcms-api:latest`,
    ]);
  });

  it("rejects an uppercase namespace rather than letting the registry do it", () => {
    // `github.repository_owner` preserves the case a person typed, and a registry
    // repository path is lowercase-only.
    expect(() => imageReferences("Roonga", "qcms-api", ["latest"])).toThrow(/lowercase/);
  });

  it("rejects a tag the reference grammar forbids", () => {
    expect(() => imageReferences("roonga", "qcms-api", ["0.0.1+abc"])).toThrow(/legal image tag/);
    expect(() => imageReferences("roonga", "qcms-api", [".leading-dot"])).toThrow(
      /legal image tag/,
    );
  });

  it("refuses to push with no tag at all", () => {
    expect(() => imageReferences("roonga", "qcms-api", [])).toThrow(/at least one --tag/);
  });
});

describe("the buildx argument vector", () => {
  const image = { name: "qcms-api", dockerfile: "docker/api.Dockerfile" };

  it("carries the attestation flags and the version stamp for either exporter", () => {
    for (const output of ["type=oci,dest=/tmp/x,tar=false", "type=registry"]) {
      const argv = buildArgv(image, "1.2.3", { tags: ["qcms-api:1.2.3"], output });
      expect(argv).toContain("--sbom=true");
      expect(argv).toContain("--provenance=mode=max");
      expect(argv).toContain("VERSION=1.2.3");
      expect(argv).toContain(output);
    }
  });

  it("repeats --tag once per reference", () => {
    const argv = buildArgv(image, "1.2.3", {
      tags: ["ghcr.io/roonga/qcms-api:abc", "ghcr.io/roonga/qcms-api:latest"],
      output: "type=registry",
    });
    expect(argv.filter((entry) => entry === "--tag")).toHaveLength(2);
  });
});

/** Copied verbatim from a probe build on buildx v0.35.0, not written from memory. */
const REAL_MANIFEST_LIST = {
  manifests: [
    {
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      digest: "sha256:f5f0b85e750ea694440efce238278ccf42624eebcde87ce93183e7d568262973",
      size: 476,
      platform: { architecture: "amd64", os: "linux" },
    },
    {
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      digest: "sha256:0e68a6981ccbff5916a6f71a02b1de50bcbb4927511ad236f33f6ede8600f486",
      size: 1106,
      annotations: {
        "vnd.docker.reference.digest":
          "sha256:f5f0b85e750ea694440efce238278ccf42624eebcde87ce93183e7d568262973",
        "vnd.docker.reference.type": "attestation-manifest",
      },
      platform: { architecture: "unknown", os: "unknown" },
    },
  ],
};

describe("the pushed manifest check", () => {
  it("counts the attestation manifest in a real buildx manifest list", () => {
    expect(attestationManifestCount(JSON.stringify(REAL_MANIFEST_LIST))).toBe(1);
  });

  it("reports none when the export dropped the attestations", () => {
    const list = JSON.stringify({ manifests: [REAL_MANIFEST_LIST.manifests[0]] });
    expect(attestationManifestCount(list)).toBe(0);
  });

  /** Each of these passes the earlier disjunction, which is the direction that matters. */
  it("does not count an unknown/unknown platform without the reference annotation", () => {
    const list = JSON.stringify({
      manifests: [{ platform: { architecture: "unknown", os: "unknown" } }],
    });
    expect(attestationManifestCount(list)).toBe(0);
  });

  it("does not count the reference annotation on a real platform", () => {
    const list = JSON.stringify({
      manifests: [
        {
          platform: { architecture: "amd64", os: "linux" },
          annotations: { "vnd.docker.reference.type": "attestation-manifest" },
        },
      ],
    });
    expect(attestationManifestCount(list)).toBe(0);
  });

  it("does not count an unknown architecture on a known os", () => {
    const list = JSON.stringify({
      manifests: [
        {
          platform: { architecture: "unknown", os: "linux" },
          annotations: { "vnd.docker.reference.type": "attestation-manifest" },
        },
      ],
    });
    expect(attestationManifestCount(list)).toBe(0);
  });

  it("survives a descriptor with no platform and no annotations at all", () => {
    expect(attestationManifestCount(JSON.stringify({ manifests: [{}] }))).toBe(0);
    expect(attestationManifestCount(JSON.stringify({}))).toBe(0);
  });
});

describe("argument parsing", () => {
  it("reads no push out of the build-only invocation CI uses on a branch", () => {
    const parsed = parseArgv(["--output", "/tmp/images"]);
    expect(parsed).toEqual({ outputRoot: "/tmp/images", namespace: undefined, tags: [] });
  });

  it("reads the namespace and every repeated tag", () => {
    expect(
      parseArgv(["--output", "/tmp/i", "--push", "roonga", "--tag", "abc", "--tag", "latest"]),
    ).toEqual({ outputRoot: "/tmp/i", namespace: "roonga", tags: ["abc", "latest"] });
  });

  it("refuses --push with no namespace instead of silently building only", () => {
    expect(() => parseArgv(["--push"])).toThrow(/--push needs a value/);
    expect(() => parseArgv(["--push", "--tag", "latest"])).toThrow(/--push needs a value/);
  });

  /** Without the guard, `String(undefined)` becomes a literal directory or tag name. */
  it("refuses a valueless --output rather than building into a directory named undefined", () => {
    expect(() => parseArgv(["--output"])).toThrow(/--output needs a value/);
    expect(() => parseArgv(["--output", "--push", "roonga"])).toThrow(/--output needs a value/);
  });

  it("refuses a valueless --tag rather than pushing a tag named undefined", () => {
    expect(() => parseArgv(["--push", "roonga", "--tag"])).toThrow(/--tag needs a value/);
    expect(() => parseArgv(["--tag", "--output", "/tmp/i"])).toThrow(/--tag needs a value/);
  });
});

describe("keeping the attestations (issue #342)", () => {
  it("names each document after the predicate it carries", () => {
    expect(attestationFileName(SPDX_PREDICATE)).toBe("spdx.dev-Document.json");
    expect(attestationFileName(PROVENANCE_PREDICATE)).toBe("slsa.dev-provenance-v1.json");
  });

  it("writes one document per predicate under the image's own directory", () => {
    const artifact = ociArtifact(BOTH, { [VERSION_LABEL]: "1.2.3" });
    const destination = mkdtempSync(join(tmpdir(), "qcms-attestations-"));
    workspaces.push(destination);

    const written = saveAttestations(artifact, "qcms-api", destination);

    expect(written).toHaveLength(2);
    expect(readdirSync(join(destination, "qcms-api")).sort()).toEqual([
      "slsa.dev-provenance-v1.json",
      "spdx.dev-Document.json",
    ]);
    const spdx: unknown = JSON.parse(
      readFileSync(join(destination, "qcms-api", "spdx.dev-Document.json"), "utf8"),
    );
    expect(spdx).toMatchObject({ predicateType: SPDX_PREDICATE });
  });

  it("can be run twice into the same directory", () => {
    // Two `--attestations` runs in a row is an ordinary local loop, and an OCI blob is
    // read-only, so the second copy fails with EACCES unless the destination is removed.
    const artifact = ociArtifact(BOTH, { [VERSION_LABEL]: "1.2.3" });
    const destination = mkdtempSync(join(tmpdir(), "qcms-attestations-"));
    workspaces.push(destination);

    saveAttestations(artifact, "qcms-api", destination);
    expect(() => saveAttestations(artifact, "qcms-api", destination)).not.toThrow();
    expect(readdirSync(join(destination, "qcms-api"))).toHaveLength(2);
  });

  it("stays off unless --attestations is passed, and refuses a bare flag", () => {
    expect(parseArgv([]).attestationRoot).toBeUndefined();
    expect(parseArgv(["--attestations", "/tmp/attestations"]).attestationRoot).toBe(
      "/tmp/attestations",
    );
    expect(() => parseArgv(["--attestations"])).toThrow(/needs a value/);
  });
});
