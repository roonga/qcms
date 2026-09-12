/**
 * Build the three QCMS images with a real version stamp and an SBOM (task 036).
 *
 * ## The two problems this solves
 *
 * 1. **Every image claimed to be `dev`.** All three Dockerfiles declare
 *    `ARG VERSION=dev` and stamp it into `org.opencontainers.image.version`, and
 *    nothing ever passed a value, so the label was present, well-formed and useless.
 *    A label that is always the same string cannot tell two builds apart, which is
 *    the entire reason to have it during an incident.
 * 2. **No SBOM.** "What is in this image" is a question an adopter's security review
 *    asks, and answering it by hand from a lockfile is a worse answer than the one
 *    buildx will generate.
 *
 * ## Why buildx and no new dependency
 *
 * `docker buildx build --sbom=true --provenance=mode=max` produces both attestations
 * natively. It needs the docker-container driver (the default `docker` driver cannot
 * attach attestations), which is why {@link ensureBuilder} exists. The SBOM step
 * pulls `docker/buildkit-syft-scanner`, so a CI job running this must not assert
 * against Docker Hub pulls.
 *
 * ## The output layout, and why `tar=false`
 *
 * `--output type=oci,dest=<dir>,tar=false` writes a plain OCI **directory**: an
 * `index.json`, a `blobs/sha256/` tree, and nothing that needs a tar reader in Node
 * to inspect. The assertions below walk it directly:
 *
 * - `index.json` points at a manifest list.
 * - The entry whose `platform.architecture` is `unknown` is the **attestation**
 *   manifest. Its layers are `application/vnd.in-toto+json`, annotated with
 *   `in-toto.io/predicate-type`: `https://spdx.dev/Document` for the SBOM and
 *   `https://slsa.dev/provenance/v1` for the provenance.
 * - The other entry is the image proper; its config blob carries `.config.Labels`,
 *   which is where the version stamp has to show up.
 *
 * That traversal is the whole verification: it checks the artifact an adopter would
 * actually receive, rather than checking that we passed the right flags.
 *
 * ## Publishing (issue #763)
 *
 * `--push <namespace>` adds a second buildx invocation per image that exports to
 * `type=registry` instead of an OCI directory, tagged `ghcr.io/<namespace>/<image>`
 * once per `--tag`. It runs only after the local artifact has passed
 * {@link assertArtifact}, so nothing reaches a registry that has not already been
 * proven to carry an SBOM, provenance and a real version stamp. The second
 * invocation is the same build definition with different tags, so BuildKit answers
 * it from the cache the first one just filled: it re-exports, it does not rebuild.
 *
 * The pushed manifest is then read back with `buildx imagetools inspect --raw` and
 * checked for an attestation manifest, because "the local copy had an SBOM" and "the
 * registry copy has one" are different claims and only the second one is what an
 * adopter pulls.
 *
 * ## Reading the SBOM back, not just proving it exists (issue #877)
 *
 * The SBOM was asserted to be PRESENT and never read. The #874 reviewer read one by
 * hand and found `vitest`, `@playwright/test` and `testcontainers` in the `qcms-api`
 * image: 680 npm packages where a production API needs a fraction of that. So
 * {@link assertNoDevPackages} now reads the document this build just generated and
 * fails if it lists anything the workspace declares only as a devDependency. It runs
 * before {@link pushImage}, because a check that runs after the push is a report
 * rather than a gate. `scripts/image-dev-deps.mjs` derives the boundary and explains
 * why the tooling was there.
 *
 * ## Keeping the attestations (issue #342)
 *
 * `--attestations <dir>` writes each image's in-toto documents out as plain JSON,
 * one file per predicate, under `<dir>/<image>/`. The `Images` workflow passes it and
 * uploads the result, because until then the SBOM was generated, asserted and then
 * discarded with the runner: the question it exists to answer stopped being answerable
 * the moment the job finished. The documents rather than the OCI directories they come
 * out of, because the size difference is what makes keeping them free: measured on the
 * three images at the time this landed, 9 MB of attestations against 376 MB of OCI
 * layers, and nobody re-pulls an image out of a workflow artifact.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { captureProcess, DOCKER, REPOSITORY_ROOT, runProcess } from "./docker.mjs";
import { assertNoDevDependencies } from "./image-dev-deps.mjs";

/** The three published images, and the Dockerfile each is built from. */
export const IMAGES = [
  { name: "qcms-api", dockerfile: "docker/api.Dockerfile" },
  { name: "qcms-portal", dockerfile: "docker/portal.Dockerfile" },
  { name: "qcms-admin", dockerfile: "docker/admin.Dockerfile" },
];

/** The buildx builder this script creates on demand; the default driver cannot attest. */
const BUILDER = "qcms-sbom";

/**
 * The registry the images publish to (issue #763).
 *
 * GHCR and not Docker Hub: it is free for this repository, and a push authenticates
 * with the built-in `GITHUB_TOKEN` under `packages: write`, so publishing introduces
 * no credential anyone has to store or rotate. `.github/workflows/mirror-test-images.yml`
 * already pushes here on the same token.
 */
export const REGISTRY = "ghcr.io";

export const SPDX_PREDICATE = "https://spdx.dev/Document";
export const PROVENANCE_PREDICATE = "https://slsa.dev/provenance/v1";
export const VERSION_LABEL = "org.opencontainers.image.version";

/**
 * The version to stamp: the workspace version plus the short commit it was built from.
 *
 * Both halves earn their place. The package version alone repeats across every build
 * between two releases, which is the `dev` problem with extra steps; the SHA alone
 * does not say which release line a container belongs to. A dirty working tree is
 * marked, because an image built from uncommitted code is not reproducible and the
 * label is the only place that fact can survive into production.
 *
 * @returns {string}
 */
export function imageVersion(env = process.env) {
  const override = env.QCMS_IMAGE_VERSION;
  if (override !== undefined && override !== "") return override;
  const pkg = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8"));
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  }).trim();
  const dirty =
    execFileSync("git", ["status", "--porcelain"], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    }).trim() !== "";
  return `${pkg.version}+${sha}${dirty ? ".dirty" : ""}`;
}

/**
 * The same version, made legal as a Docker tag.
 *
 * `0.0.1-alpha.0+83fa947` is correct SemVer (`+` introduces build metadata) and an
 * illegal image reference: a tag is `[A-Za-z0-9_][A-Za-z0-9._-]{0,127}`, with no `+`.
 * The label keeps the true version, because that is the field an adopter reads to
 * identify a build; only the tag is rewritten.
 *
 * `+` becomes `_`, and the choice is injectivity rather than taste (issue #342). `-`
 * is legal in a SemVer version, so `1.0.0+build.5` and `1.0.0-build.5` are two
 * different releases that both used to produce the tag `1.0.0-build.5`: the second
 * build silently moved the first one's tag. `_` cannot appear in a SemVer version at
 * all and is a legal tag character, so the rewrite is one-to-one for every version
 * this can be handed.
 *
 * The previous comment here justified `-` by saying the SHA "stays visible in
 * `docker images`". That was never true of this script: {@link buildImage} exports
 * with `--output type=oci,dest=...`, so the image never enters the local daemon store
 * and `docker images` never lists it. The tag is read off the OCI descriptor, or off
 * the registry after {@link pushImage}.
 *
 * @param {string} version
 * @returns {string}
 */
export function imageTag(version) {
  return version.replaceAll("+", "_");
}

/** Create the docker-container builder if it is not already there. */
export function ensureBuilder() {
  const existing = captureProcess(DOCKER, ["buildx", "ls", "--format", "{{.Name}}"]);
  if (existing.split("\n").includes(BUILDER)) return;
  runProcess(DOCKER, ["buildx", "create", "--name", BUILDER, "--driver", "docker-container"]);
}

/**
 * Where one blob of an OCI directory layout lives on disk.
 *
 * @param {string} directory
 * @param {string} digest
 * @returns {string}
 */
function ociBlobPath(directory, digest) {
  return join(directory, "blobs", "sha256", digest.replace("sha256:", ""));
}

/**
 * @param {string} directory
 * @param {string} digest
 * @returns {any}
 */
function readOciBlob(directory, digest) {
  return JSON.parse(readFileSync(ociBlobPath(directory, digest), "utf8"));
}

/**
 * Every manifest the artifact's index points at, paired with its descriptor.
 *
 * One walk, two readers: {@link inspectOciArtifact} wants the labels and the predicate
 * types, {@link attestationBlobs} wants the blobs themselves. Writing the traversal
 * twice is how the two would come to disagree about which entry is the attestation.
 *
 * @param {string} directory
 * @returns {{ entry: any, manifest: any }[]}
 */
function ociManifests(directory) {
  const index = JSON.parse(readFileSync(join(directory, "index.json"), "utf8"));
  const manifestList = readOciBlob(directory, index.manifests[0].digest);
  return manifestList.manifests.map((/** @type {any} */ entry) => ({
    entry,
    manifest: readOciBlob(directory, entry.digest),
  }));
}

/** The annotation buildx puts on each in-toto layer, naming what that layer asserts. */
const PREDICATE_ANNOTATION = "in-toto.io/predicate-type";

/**
 * Read an OCI directory layout and return the descriptors that matter.
 *
 * @param {string} directory
 * @returns {{ labels: Record<string, string>, predicates: string[] }}
 */
export function inspectOciArtifact(directory) {
  /** @type {string[]} */
  const predicates = [];
  /** @type {Record<string, string>} */
  let labels = {};

  for (const { entry, manifest } of ociManifests(directory)) {
    if (entry.platform?.architecture === "unknown") {
      // The attestation manifest: one in-toto layer per predicate.
      for (const layer of manifest.layers ?? []) {
        const predicate = layer.annotations?.[PREDICATE_ANNOTATION];
        if (predicate !== undefined) predicates.push(predicate);
      }
      continue;
    }
    labels = readOciBlob(directory, manifest.config.digest).config?.Labels ?? {};
  }
  return { labels, predicates };
}

/**
 * The in-toto attestation blobs in an artifact, each with the predicate it asserts.
 *
 * @param {string} directory
 * @returns {{ predicate: string, path: string }[]}
 */
export function attestationBlobs(directory) {
  /** @type {{ predicate: string, path: string }[]} */
  const found = [];
  for (const { entry, manifest } of ociManifests(directory)) {
    if (entry.platform?.architecture !== "unknown") continue;
    for (const layer of manifest.layers ?? []) {
      const predicate = layer.annotations?.[PREDICATE_ANNOTATION];
      if (predicate !== undefined) {
        found.push({ predicate, path: ociBlobPath(directory, layer.digest) });
      }
    }
  }
  return found;
}

/**
 * A predicate type as a file name: `https://spdx.dev/Document` becomes
 * `spdx.dev-Document.json`.
 *
 * The scheme goes and the path separators become hyphens, so the name is legal on
 * every filesystem a CI artifact is unpacked on and still says which predicate it is.
 *
 * @param {string} predicate
 * @returns {string}
 */
export function attestationFileName(predicate) {
  return `${predicate.replace(/^https?:\/\//, "").replaceAll("/", "-")}.json`;
}

/**
 * Write one image's attestation blobs out as plain JSON files (issue #342).
 *
 * The SBOM and the provenance were generated, asserted and then thrown away with the
 * runner: nothing uploaded them, so "what was in that build" - the question an SBOM
 * exists to answer - stopped being answerable the moment the job finished. This is
 * the cheapest thing that fixes it: the in-toto documents are the part anyone reads,
 * and on the three images at the time this landed they were 9 MB against the OCI
 * directories' 376 MB.
 *
 * The destination is removed before each copy. A blob in an OCI layout is written
 * read-only (0444), and `copyFileSync` inherits that mode, so a second run into the
 * same directory would fail with EACCES on a file this function itself wrote - which
 * is exactly what a local `pnpm qcms:build-images --attestations` twice in a row is.
 *
 * @param {string} directory the OCI directory this image was exported to.
 * @param {string} name the image name, which becomes the subdirectory.
 * @param {string} outputRoot where to write.
 * @returns {string[]} the files written.
 */
export function saveAttestations(directory, name, outputRoot) {
  const target = join(outputRoot, name);
  mkdirSync(target, { recursive: true });
  return attestationBlobs(directory).map(({ predicate, path }) => {
    const file = join(target, attestationFileName(predicate));
    rmSync(file, { force: true });
    copyFileSync(path, file);
    return file;
  });
}

/**
 * Assert the image's own SBOM lists no package this workspace only develops with.
 *
 * Separate from {@link assertArtifact} because it reads the attestation's BODY rather
 * than its descriptor: that function asks whether an SBOM is attached, this one asks
 * what it says. Both run before a push.
 *
 * @param {string} directory an OCI directory layout.
 * @param {string} name the image, for the message.
 * @returns {number} how many npm packages the SBOM listed, for the build log.
 */
export function assertNoDevPackages(directory, name) {
  const sbom = attestationBlobs(directory).find(({ predicate }) => predicate === SPDX_PREDICATE);
  if (sbom === undefined) {
    // Unreachable through buildImage, which calls assertArtifact first; a direct caller
    // gets the same message that function would have given rather than a TypeError.
    throw new Error(`build-images: ${name} has no SBOM (${SPDX_PREDICATE}) to read`);
  }
  return assertNoDevDependencies(JSON.parse(readFileSync(sbom.path, "utf8")), name);
}

/**
 * Assert the artifact carries an SBOM, provenance, and the expected version stamp.
 *
 * @param {string} directory
 * @param {string} version
 * @param {string} name
 */
export function assertArtifact(directory, version, name) {
  const { labels, predicates } = inspectOciArtifact(directory);
  const problems = [];
  // Whole-element equality, spelled out. `predicates` is an array, so `.includes()` was
  // already exact - but CodeQL reads it as `String.prototype.includes` and reports
  // js/incomplete-url-substring-sanitization, since these predicate types are URLs. The
  // explicit comparison says the same thing in a form no reader has to type-infer.
  if (!predicates.some((predicate) => predicate === SPDX_PREDICATE)) {
    problems.push(`no SBOM (${SPDX_PREDICATE})`);
  }
  if (!predicates.some((predicate) => predicate === PROVENANCE_PREDICATE)) {
    problems.push(`no provenance (${PROVENANCE_PREDICATE})`);
  }
  const stamped = labels[VERSION_LABEL];
  if (stamped !== version) {
    problems.push(
      `${VERSION_LABEL} is ${JSON.stringify(stamped)}, expected ${JSON.stringify(version)}`,
    );
  }
  if (stamped === "dev") problems.push("the version stamp is still the Dockerfile default");
  if (problems.length > 0) {
    throw new Error(
      `build-images: ${name} failed its supply-chain assertions:\n  ${problems.join("\n  ")}`,
    );
  }
}

/**
 * The buildx argument vector for one image, with the exporter and tags supplied.
 *
 * One function for both the local build and the push, so the two cannot drift on the
 * flags that decide what the artifact contains. Only `--tag` and `--output` differ:
 * neither is part of the build graph, so BuildKit serves the push from the cache the
 * local build filled rather than building the image a second time.
 *
 * @param {{ name: string, dockerfile: string }} image
 * @param {string} version
 * @param {{ tags: string[], output: string }} exporter
 * @returns {string[]}
 */
export function buildArgv(image, version, { tags, output }) {
  return [
    "buildx",
    "build",
    "--builder",
    BUILDER,
    "--file",
    image.dockerfile,
    "--build-arg",
    `VERSION=${version}`,
    "--sbom=true",
    "--provenance=mode=max",
    ...tags.flatMap((tag) => ["--tag", tag]),
    "--output",
    output,
    ".",
  ];
}

/**
 * The registry references one image publishes under.
 *
 * A repository path must be lowercase, and a tag is `[A-Za-z0-9_][A-Za-z0-9._-]{0,127}`.
 * Both are checked here rather than left to the registry, because a rejected push in
 * CI reads as an infrastructure failure and this reads as the mistake it is. The owner
 * arrives from `github.repository_owner`, which preserves the case a person typed.
 *
 * @param {string} namespace registry namespace, for example `roonga`.
 * @param {string} name image name, for example `qcms-api`.
 * @param {string[]} tags one or more tags to publish the same build under.
 * @returns {string[]}
 */
export function imageReferences(namespace, name, tags) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(namespace)) {
    throw new Error(
      `build-images: ${JSON.stringify(namespace)} is not a legal registry namespace; it must be lowercase`,
    );
  }
  if (tags.length === 0) throw new Error("build-images: --push needs at least one --tag");
  for (const tag of tags) {
    if (!/^\w[\w.-]{0,127}$/.test(tag)) {
      throw new Error(`build-images: ${JSON.stringify(tag)} is not a legal image tag`);
    }
  }
  return tags.map((tag) => `${REGISTRY}/${namespace}/${name}:${tag}`);
}

/**
 * The attestation manifests in a raw manifest list.
 *
 * The test is a CONJUNCTION of all three descriptor properties buildx actually
 * writes, because this is the one assertion the whole push path exists for and a
 * permissive test here would report success on an artifact that lost its
 * attestations. Leaning permissive is the wrong direction for a check whose only
 * job is to catch that loss.
 *
 * Reality, from `docker buildx build --sbom=true --provenance=mode=max` on
 * buildx v0.35.0 (both descriptors of a single-platform build, verbatim):
 *
 * ```json
 * { "mediaType": "application/vnd.oci.image.manifest.v1+json",
 *   "digest": "sha256:f5f0b85e...", "size": 476,
 *   "platform": { "architecture": "amd64", "os": "linux" } }
 * { "mediaType": "application/vnd.oci.image.manifest.v1+json",
 *   "digest": "sha256:0e68a698...", "size": 1106,
 *   "annotations": { "vnd.docker.reference.digest": "sha256:f5f0b85e...",
 *                    "vnd.docker.reference.type": "attestation-manifest" },
 *   "platform": { "architecture": "unknown", "os": "unknown" } }
 * ```
 *
 * So the attestation descriptor carries the `unknown/unknown` platform AND the
 * reference-type annotation, and the image descriptor carries neither. Requiring
 * both means a descriptor has to be an attestation manifest on the two independent
 * markers rather than on either one alone: the `unknown/unknown` platform is the
 * convention that hides these entries from a platform-matching client, and other
 * non-image entries could adopt it, while the annotation is what names this entry
 * as the attestation for a specific image.
 *
 * The manifest it points at carries `artifactType`
 * `application/vnd.docker.attestation.manifest.v1+json` and one
 * `application/vnd.in-toto+json` layer per predicate, which is the layer shape
 * {@link inspectOciArtifact} already walks for the local artifact. This function
 * deliberately stops at the descriptor: `imagetools inspect --raw` returns the index
 * alone, and fetching each referenced manifest would be a second registry round trip
 * for a weaker question than "did the attestations get pushed at all".
 *
 * @param {string} rawManifestList the JSON `buildx imagetools inspect --raw` prints.
 * @returns {number} how many attestation manifests the list carries.
 */
export function attestationManifestCount(rawManifestList) {
  /** @type {{ manifests?: { platform?: { architecture?: string, os?: string }, annotations?: Record<string, string> }[] }} */
  const index = JSON.parse(rawManifestList);
  return (index.manifests ?? []).filter(
    (entry) =>
      entry.platform?.architecture === "unknown" &&
      entry.platform.os === "unknown" &&
      entry.annotations?.["vnd.docker.reference.type"] === "attestation-manifest",
  ).length;
}

/**
 * @param {{ name: string, dockerfile: string }} image
 * @param {string} version
 * @param {string} outputRoot
 * @param {string | undefined} attestationRoot where to copy the in-toto documents, if
 *   anywhere. Written only after {@link assertArtifact} has passed, so a saved
 *   attestation is always one this run also verified.
 */
export function buildImage(image, version, outputRoot, attestationRoot) {
  const destination = join(outputRoot, image.name);
  runProcess(
    DOCKER,
    buildArgv(image, version, {
      tags: [`${image.name}:${imageTag(version)}`],
      output: `type=oci,dest=${destination},tar=false`,
    }),
  );
  assertArtifact(destination, version, image.name);
  const npmPackages = assertNoDevPackages(destination, image.name);
  process.stdout.write(
    `build-images: ${image.name} ${version} - SBOM, provenance and stamp present; ` +
      `${String(npmPackages)} npm packages, none dev-only\n`,
  );
  if (attestationRoot === undefined) return;
  for (const file of saveAttestations(destination, image.name, attestationRoot)) {
    process.stdout.write(`build-images: wrote ${file}\n`);
  }
}

/**
 * Publish one already-asserted image to the registry, then read the pushed manifest
 * back and require the attestations to have survived the export.
 *
 * @param {{ name: string, dockerfile: string }} image
 * @param {string} version
 * @param {string} namespace
 * @param {string[]} tags
 */
export function pushImage(image, version, namespace, tags) {
  const references = imageReferences(namespace, image.name, tags);
  runProcess(DOCKER, buildArgv(image, version, { tags: references, output: "type=registry" }));
  for (const reference of references) {
    const raw = captureProcess(DOCKER, ["buildx", "imagetools", "inspect", "--raw", reference]);
    if (attestationManifestCount(raw) === 0) {
      throw new Error(
        `build-images: ${reference} was pushed without an attestation manifest; the SBOM and provenance did not survive the export`,
      );
    }
    process.stdout.write(`build-images: pushed ${reference} with its attestations\n`);
  }
}

/**
 * The value following a flag, or a thrown error naming the flag.
 *
 * Every flag this script takes is value-bearing, so a missing value is always a
 * mistake and never a shorthand. Reading it without this guard produces `undefined`,
 * which `String()` turns into the literal `"undefined"`: `--output` with no value
 * would build into a directory named `undefined`, and `--tag` with no value would
 * push a tag named `undefined`. Both are downstream failures at best and a wrong
 * artifact at worst, so the parser refuses them here where the message can name the
 * flag the caller actually got wrong.
 *
 * @param {string[]} argv
 * @param {number} flagIndex position of the flag itself.
 * @param {string} flag the flag's name, for the message.
 * @param {string} example a correct invocation to show.
 * @returns {string}
 */
function valueAfter(argv, flagIndex, flag, example) {
  const value = argv[flagIndex + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`build-images: ${flag} needs a value, for example ${example}`);
  }
  return value;
}

/**
 * Read `--output`, `--push`, `--attestations` and the repeatable `--tag` out of the
 * argument vector.
 *
 * @param {string[]} argv
 * @returns {{ outputRoot: string, namespace: string | undefined, tags: string[],
 *   attestationRoot: string | undefined }}
 */
export function parseArgv(argv) {
  const outputIndex = argv.indexOf("--output");
  const pushIndex = argv.indexOf("--push");
  const attestationsIndex = argv.indexOf("--attestations");
  /** @type {string[]} */
  const tags = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--tag") {
      tags.push(valueAfter(argv, index, "--tag", "--tag latest"));
    }
  }
  const namespace =
    pushIndex === -1
      ? undefined
      : valueAfter(argv, pushIndex, "--push", "--push roonga (a registry namespace)");
  const outputRoot =
    outputIndex === -1
      ? join(REPOSITORY_ROOT, "dist-images")
      : valueAfter(argv, outputIndex, "--output", "--output ./dist-images");
  const attestationRoot =
    attestationsIndex === -1
      ? undefined
      : valueAfter(argv, attestationsIndex, "--attestations", "--attestations ./dist-attestations");
  return { outputRoot, namespace, tags, attestationRoot };
}

export function main(argv = process.argv.slice(2)) {
  const { outputRoot, namespace, tags, attestationRoot } = parseArgv(argv);
  const version = imageVersion();
  process.stdout.write(`build-images: version ${version}\n`);
  ensureBuilder();
  for (const image of IMAGES) {
    if (!existsSync(join(REPOSITORY_ROOT, image.dockerfile))) {
      throw new Error(`build-images: ${image.dockerfile} is missing`);
    }
    buildImage(image, version, outputRoot, attestationRoot);
    if (namespace !== undefined) pushImage(image, version, namespace, tags);
  }
  process.stdout.write(
    `build-images: all ${String(IMAGES.length)} images built into ${outputRoot}` +
      (namespace === undefined
        ? "\n"
        : ` and published to ${REGISTRY}/${namespace} as ${tags.join(", ")}\n`),
  );
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
}
