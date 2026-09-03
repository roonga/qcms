import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  appManifest,
  assertComposeForwardsTwoFactor,
  assertImports,
  buildTemplates,
  diffTrees,
  isExcludedAppPath,
  outputName,
  publishedVersions,
  renderEnvExample,
  templateName,
  transformDockerfile,
  walk,
} from "./sync-templates.mjs";
import { templateFiles } from "../src/templates.js";

describe("the strip rules", () => {
  it.each([
    "src/app.test.ts",
    "components/kit.test.tsx",
    "src/test-support.ts",
    "CONTRIBUTING.md",
    "README.md",
    "src/features/forms/README.md",
    ".env.example",
    "scripts/seed-fixtures.ts",
  ])("drops %j", (path) => {
    expect(isExcludedAppPath(path)).toBe(true);
  });

  it.each(["src/app.ts", "components/kit.tsx", "app/globals.css", ".gitignore", "tsconfig.json"])(
    "keeps %j",
    (path) => {
      expect(isExcludedAppPath(path)).toBe(false);
    },
  );
});

describe("the dot-file convention", () => {
  it.each([
    [".gitignore", "_gitignore"],
    ["apps/portal/.gitignore", "apps/portal/_gitignore"],
    ["docker/api.Dockerfile.tmpl", "docker/api.Dockerfile.tmpl"],
  ])("maps %j to %j and back", (output, template) => {
    expect(templateName(output)).toBe(template);
    expect(outputName(template)).toBe(output);
  });
});

describe("transformDockerfile", () => {
  const SOURCE = [
    "COPY package.json ./",
    "COPY apps ./apps",
    "COPY packages ./packages",
    "# Why tooling has to be here, in prose that explains the line below.",
    "COPY scripts ./scripts",
    "COPY tooling ./tooling",
    "RUN pnpm --filter qcms-api... build",
    'LABEL org.opencontainers.image.title="qcms-api" \\',
    '      org.opencontainers.image.version="${VERSION}" \\',
    '      org.opencontainers.image.source="https://github.com/roonga/qcms"',
  ].join("\n");

  it("drops every COPY line naming a directory the scaffold has not got", () => {
    const result = transformDockerfile(SOURCE, "qcms-api", "api");
    expect(result).not.toContain("COPY packages ./packages");
    expect(result).not.toContain("COPY scripts ./scripts");
    expect(result).not.toContain("COPY tooling ./tooling");
    expect(result).toContain("COPY apps ./apps");
  });

  it("takes the comment block that explains a dropped line with it", () => {
    // Otherwise the adopter reads a paragraph about a line that is not there.
    expect(transformDockerfile(SOURCE, "qcms-api", "api")).not.toContain("in prose that explains");
  });

  it("throws when a declared monorepo-only COPY is no longer present", () => {
    // The defect this replaces was a filter on two exact string literals: a renamed or
    // rewhitespaced line made it a silent no-op, and the adopter's image then failed on
    // a COPY of a directory the scaffold has not got (issue #456, blind spot C).
    const withoutTooling = SOURCE.split("\n")
      .filter((line) => line !== "COPY tooling ./tooling")
      .join("\n");
    expect(() => transformDockerfile(withoutTooling, "qcms-api", "api")).toThrow(
      /no longer copies/,
    );
  });

  it("throws when a COPY names a root directory nobody has classified", () => {
    const withNewDirectory = SOURCE.replace(
      "COPY apps ./apps",
      "COPY apps ./apps\nCOPY fixtures ./fixtures",
    );
    expect(() => transformDockerfile(withNewDirectory, "qcms-api", "api")).toThrow(
      /copies "fixtures"/,
    );
  });

  it("rewrites the workspace-dependency build into a plain one", () => {
    expect(transformDockerfile(SOURCE, "qcms-api", "api")).toContain(
      "RUN pnpm --filter qcms-api build",
    );
  });

  it("stamps the adopter's image title and drops the source label", () => {
    // A scaffolded image must not claim to come from this repository: the code inside
    // it is the adopter's (issue #457, tier 1).
    const result = transformDockerfile(SOURCE, "qcms-api", "api");
    expect(result).toContain('org.opencontainers.image.title="{{projectName}}-api"');
    expect(result).not.toContain("github.com/roonga/qcms");
    expect(result).toContain('org.opencontainers.image.version="${VERSION}"');
  });

  it("throws rather than silently doing nothing when the build anchor is gone", () => {
    expect(() => transformDockerfile("FROM node:24", "qcms-api", "api")).toThrow(
      /no longer contains/,
    );
  });

  it("throws rather than silently leaving QCMS's identity when the labels move", () => {
    const withoutLabels = SOURCE.split("\n")
      .filter((line) => !line.includes("org.opencontainers"))
      .join("\n");
    expect(() => transformDockerfile(withoutLabels, "qcms-api", "api")).toThrow(/OCI title/);
  });
});

describe("assertComposeForwardsTwoFactor", () => {
  const PASSTHROUGH = "QCMS_ADMIN_2FA: ${QCMS_ADMIN_2FA:-required}";
  const SOURCE = [
    "services:",
    "  api:",
    "    environment:",
    `      ${PASSTHROUGH}`,
    "  admin:",
    "    environment:",
    `      ${PASSTHROUGH}`,
    "volumes:",
    "  data:",
  ].join("\n");

  it("passes the canonical shape through unchanged", () => {
    expect(assertComposeForwardsTwoFactor(SOURCE)).toBe(SOURCE);
  });

  it("throws when a service that reads the policy stops being given it", () => {
    // The CLI prompts for the policy and writes it to .env. Without the passthrough the
    // adopter's answer reaches nothing, silently.
    const withoutAdmin = SOURCE.replace(
      `  admin:\n    environment:\n      ${PASSTHROUGH}`,
      "  admin:",
    );
    expect(() => assertComposeForwardsTwoFactor(withoutAdmin)).toThrow(/no longer forwards/);
  });

  it("throws on a duplicate, which a YAML reader resolves silently", () => {
    // This is the state the generator itself produced once `main` added the
    // passthrough that the old transform 5 was inserting.
    const duplicated = SOURCE.replace(
      `  api:\n    environment:\n      ${PASSTHROUGH}`,
      `  api:\n    environment:\n      ${PASSTHROUGH}\n      ${PASSTHROUGH}`,
    );
    expect(() => assertComposeForwardsTwoFactor(duplicated)).toThrow(/copies of/);
  });
});

describe("renderEnvExample", () => {
  const BASE = { text: "x: ${QCMS_APP_KEY:?set it}\ny: ${QCMS_DB_NAME:-qcms}", alwaysRuns: true };
  const OVERLAY = { text: "z: ${QCMS_ACME_EMAIL:?set it}", alwaysRuns: false };

  it("writes a base-topology mandatory variable uncommented", () => {
    expect(renderEnvExample([BASE])).toMatch(/^QCMS_APP_KEY=$/m);
  });

  it("writes an optional variable commented out", () => {
    expect(renderEnvExample([BASE])).toMatch(/^# QCMS_DB_NAME=$/m);
  });

  it("leaves an overlay's mandatory variable commented, since the overlay is optional", () => {
    const rendered = renderEnvExample([BASE, OVERLAY]);
    expect(rendered).toContain("QCMS_ACME_EMAIL");
    expect(rendered).toMatch(/^# QCMS_ACME_EMAIL=$/m);
  });

  it("marks key material, which is what tells the CLI it may generate a value", () => {
    expect(renderEnvExample([BASE])).toContain("# (required, secret)");
  });

  it("refuses a variable the configuration schema does not document", () => {
    expect(() => renderEnvExample([{ text: "a: ${QCMS_INVENTED:?x}", alwaysRuns: true }])).toThrow(
      /QCMS_INVENTED/,
    );
  });

  it("skips the values Compose supplies to itself", () => {
    const rendered = renderEnvExample([
      { text: "a: ${POSTGRES_USER}\nb: ${QCMS_APP_KEY:?x}", alwaysRuns: true },
    ]);
    expect(rendered).not.toContain("POSTGRES_USER");
  });
});

describe("appManifest", () => {
  const versions = publishedVersions();

  it.each(["api", "portal", "admin"] as const)(
    "gives %s registry ranges, not workspace links",
    (app) => {
      const manifest = appManifest(app, versions) as {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
        scripts: Record<string, string>;
      };
      const all = { ...manifest.dependencies, ...manifest.devDependencies };
      expect(Object.values(all)).not.toContain("workspace:*");
      for (const [name, range] of Object.entries(all)) {
        if (name.startsWith("@qcms/")) expect(range).toMatch(/^\^\d+\.\d+\.\d+$/);
      }
    },
  );

  it("keeps no script that needs this repository's runners", () => {
    for (const app of ["api", "portal", "admin"] as const) {
      const manifest = appManifest(app, versions) as { scripts: Record<string, string> };
      expect(Object.keys(manifest.scripts)).not.toContain("test");
      expect(Object.keys(manifest.scripts)).not.toContain("lint");
    }
  });

  it("drops the harness devDependencies", () => {
    const api = appManifest("api", versions) as { devDependencies: Record<string, string> };
    expect(api.devDependencies).not.toHaveProperty("@testcontainers/postgresql");
    expect(api.devDependencies).toHaveProperty("@types/node");
  });
});

describe("assertImports", () => {
  it("refuses a scaffolded file importing a package its app does not declare", () => {
    const tree = new Map(buildTemplates());
    tree.set("common/apps/portal/lib/rogue.ts", 'import { x } from "@qcms/db";');
    expect(() => assertImports(tree)).toThrow(/@qcms\/db, which apps\/portal does not declare/);
  });

  it("passes on the tree the generator actually produces", () => {
    expect(() => assertImports(buildTemplates())).not.toThrow();
  });
});

describe("the drift gate", () => {
  it("says nothing when the committed tree matches", () => {
    const generated = buildTemplates();
    expect(diffTrees(generated, new Map(generated))).toStrictEqual([]);
  });

  it("reports a template whose canonical source changed", () => {
    const generated = buildTemplates();
    const committed = new Map(generated);
    committed.set("common/apps/api/src/app.ts", "// an edit nobody regenerated");
    expect(diffTrees(generated, committed)).toStrictEqual([
      "drifted:  packages/create-qcms-app/templates/common/apps/api/src/app.ts",
    ]);
  });

  it("reports a template that was never generated", () => {
    const generated = buildTemplates();
    const committed = new Map(generated);
    committed.delete("common/apps/api/src/app.ts");
    expect(diffTrees(generated, committed)).toStrictEqual([
      "missing:  packages/create-qcms-app/templates/common/apps/api/src/app.ts",
    ]);
  });

  it("reports a template left behind after its source was deleted", () => {
    const generated = buildTemplates();
    const committed = new Map(generated);
    committed.set("common/apps/api/src/removed.ts", "// stale");
    expect(diffTrees(generated, committed)).toStrictEqual([
      "stale:    packages/create-qcms-app/templates/common/apps/api/src/removed.ts",
    ]);
  });
});

describe("reading a generated tree (issue #450)", () => {
  // The gate compares the COMMITTED template tree against a regenerated one, and it
  // used to read the committed side through a walk that skipped `dist`, `e2e`,
  // `coverage`, `.next` and six other directory names. That list is right for reading
  // `apps/`, which is what it was written for, and wrong for reading a tree that is
  // supposed to be compared exhaustively: the CLI's own stamping walk skips nothing, so
  // a file committed at `templates/common/apps/api/dist/leak.js` was stamped into every
  // scaffolded project while being invisible to `pnpm check:templates`.
  //
  // The fixture is a temporary tree rather than a committed file, because committing
  // one is the thing the gate exists to catch.
  let root = "";

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "qcms-walk-"));
    for (const relative of [
      "common/apps/api/src/app.ts",
      "common/apps/api/dist/leak.js",
      "common/apps/api/e2e/harness.ts",
      "common/apps/api/coverage/index.html",
      "common/apps/portal/.next/build-manifest.json",
      "common/apps/portal/__snapshots__/x.snap",
      "solo/docker-compose.proxy.yml",
    ]) {
      const absolute = join(root, ...relative.split("/"));
      mkdirSync(join(absolute, ".."), { recursive: true });
      writeFileSync(absolute, "// fixture");
    }
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("sees a file under every directory name the old skip list hid", () => {
    expect(walk("common", root)).toStrictEqual([
      "common/apps/api/coverage/index.html",
      "common/apps/api/dist/leak.js",
      "common/apps/api/e2e/harness.ts",
      "common/apps/api/src/app.ts",
      "common/apps/portal/.next/build-manifest.json",
      "common/apps/portal/__snapshots__/x.snap",
    ]);
  });

  it("reports such a file as stale rather than staying green", () => {
    // The whole point: the generator would never produce `dist/leak.js`, so once the
    // walk can see it the diff has to call it out.
    const committed = new Map(walk("common", root).map((path) => [path, "// fixture"]));
    const generated = new Map([["common/apps/api/src/app.ts", "// fixture"]]);
    expect(diffTrees(generated, committed)).toContain(
      "stale:    packages/create-qcms-app/templates/common/apps/api/dist/leak.js",
    );
  });

  it("agrees with the walk the CLI stamps through, which is the asymmetry that was the bug", () => {
    const stamped = [...templateFiles("solo", root).keys()].sort();
    const scanned = [...walk("common", root), ...walk("solo", root)]
      .map((path) => path.slice(path.indexOf("/") + 1))
      .sort();
    expect(stamped).toStrictEqual(scanned);
  });
});
