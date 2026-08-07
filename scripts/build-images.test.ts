import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  assertArtifact,
  IMAGES,
  imageTag,
  imageVersion,
  inspectOciArtifact,
  PROVENANCE_PREDICATE,
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
    expect(imageTag("0.0.1-alpha.0+83fa947")).toMatch(/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/);
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
