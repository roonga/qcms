import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  assertArtifact,
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
  SPDX_PREDICATE,
  VERSION_LABEL,
} from "./build-images.mjs";

/**
 * Unit cover for the supply-chain build (task 036, exit criterion 3).
 *
 * **What this file does not do is build an image.** A real `docker buildx` run of the
 * three images takes minutes and pulls a scanner image, which does not belong in
 * `pnpm test`; the workflow in `.github/workflows/images.yml` does the real build and
 * calls the same `assertArtifact` against the real artifact. What is worth asserting
 * cheaply is the part that would silently do the wrong thing: the version derivation,
 * the tag sanitisation, and the OCI traversal that decides whether an attestation is
 * present at all.
 *
 * The traversal is tested against a hand-built OCI directory rather than a recorded
 * one. A fixture copied out of a real build would be 200MB of layers to assert over
 * three JSON documents, and the layout is a published spec: writing it out here also
 * documents the shape the traversal expects, which is otherwise only discoverable by
 * running a build and poking at the result.
 */

const workspaces: string[] = [];

afterAll(() => {
  for (const directory of workspaces) rmSync(directory, { recursive: true, force: true });
});

/**
 * Write a minimal OCI directory layout: index -> manifest list -> {image, attestation}.
 *
 * @param predicates predicate types the attestation manifest advertises.
 * @param labels config labels the image manifest's config blob carries.
 */
function ociArtifact(predicates: string[], labels: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "qcms-oci-"));
  workspaces.push(root);
  const blobs = join(root, "blobs", "sha256");
  mkdirSync(blobs, { recursive: true });

  let next = 0;
  const put = (value: unknown): string => {
    // Digests are opaque to the traversal: it follows them, it does not verify them.
    const digest = `${String(next++).padStart(64, "0")}`;
    writeFileSync(join(blobs, digest), JSON.stringify(value));
    return `sha256:${digest}`;
  };

  const configDigest = put({ config: { Labels: labels } });
  const imageDigest = put({ config: { digest: configDigest }, layers: [] });
  const attestationDigest = put({
    layers: predicates.map((predicate) => ({
      mediaType: "application/vnd.in-toto+json",
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
    // An empty override is not an override: an unset variable and one set to "" reach
    // a shell script identically, and treating "" as a version would stamp an image
    // with the empty string rather than failing or falling back.
    const derived = imageVersion({ QCMS_IMAGE_VERSION: "" });
    expect(derived).toMatch(/^\d+\.\d+\.\d+[^+]*\+[0-9a-f]{7,}(\.dirty)?$/);
  });

  it("makes the version legal as a Docker tag without losing the commit", () => {
    // `+` is valid SemVer build metadata and illegal in an image reference. This
    // caught a real failure: the first build died on `invalid reference format`.
    expect(imageTag("0.0.1-alpha.0+83fa947")).toBe("0.0.1-alpha.0-83fa947");
    expect(imageTag("0.0.1-alpha.0+83fa947")).toMatch(/^\w[\w.-]{0,127}$/);
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
    // Every image carried version=dev before this change, because the Dockerfiles
    // declared ARG VERSION and nothing passed one. A stamp that silently reverts to
    // that is the regression worth failing a build over.
    const artifact = ociArtifact(BOTH, { [VERSION_LABEL]: "dev" });
    expect(() => assertArtifact(artifact, "1.2.3", "qcms-api")).toThrow(/expected/);
  });

  it("rejects a stamp that does not match what was requested", () => {
    const artifact = ociArtifact(BOTH, { [VERSION_LABEL]: "9.9.9" });
    expect(() => assertArtifact(artifact, "1.2.3", "qcms-api")).toThrow(/9\.9\.9/);
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

/**
 * Publishing (issue #763). None of this boots Docker either: what is worth asserting
 * is the part that decides WHAT gets pushed and WHERE, because a wrong reference is
 * either a rejected push or, worse, an accepted one under the wrong name.
 */
describe("registry references", () => {
  it("names every tag under the registry and namespace", () => {
    expect(imageReferences("roonga", "qcms-api", ["abc123", "latest"])).toEqual([
      `${REGISTRY}/roonga/qcms-api:abc123`,
      `${REGISTRY}/roonga/qcms-api:latest`,
    ]);
  });

  it("rejects an uppercase namespace rather than letting the registry do it", () => {
    // `github.repository_owner` preserves the case a person typed, and a registry
    // repository path is lowercase-only. Caught here it reads as a mistake; caught by
    // GHCR it reads as an outage.
    expect(() => imageReferences("Roonga", "qcms-api", ["latest"])).toThrow(/lowercase/);
  });

  it("rejects a tag the reference grammar forbids", () => {
    // The version stamp contains `+`, which is why imageTag exists; a caller that
    // forgot to sanitise would otherwise fail deep inside buildx.
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

/**
 * The real manifest list `docker buildx build --sbom=true --provenance=mode=max`
 * writes, copied verbatim from a probe build on buildx v0.35.0 rather than written
 * from memory. Both descriptors are here because the check is a conjunction, and the
 * image descriptor is what proves the conjunction excludes something.
 */
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
    // The failure this exists for: an exporter that quietly ships the image alone.
    const list = JSON.stringify({ manifests: [REAL_MANIFEST_LIST.manifests[0]] });
    expect(attestationManifestCount(list)).toBe(0);
  });

  /**
   * The conjunction, one missing marker at a time. Each of these passed the earlier
   * disjunction, which is the direction that matters: this check exists to catch a
   * lost attestation, so a descriptor that is only half an attestation manifest must
   * not be counted as one.
   */
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

  /**
   * Every flag here is value-bearing, so a missing value is always a mistake. Without
   * the guard `String(undefined)` makes it a literal: a directory named `undefined`,
   * or a pushed tag named `undefined`.
   */
  it("refuses a valueless --output rather than building into a directory named undefined", () => {
    expect(() => parseArgv(["--output"])).toThrow(/--output needs a value/);
    expect(() => parseArgv(["--output", "--push", "roonga"])).toThrow(/--output needs a value/);
  });

  it("refuses a valueless --tag rather than pushing a tag named undefined", () => {
    expect(() => parseArgv(["--push", "roonga", "--tag"])).toThrow(/--tag needs a value/);
    expect(() => parseArgv(["--tag", "--output", "/tmp/i"])).toThrow(/--tag needs a value/);
  });
});
