import { describe, expect, it } from "vitest";

import {
  appManifest,
  assertImports,
  buildTemplates,
  diffTrees,
  isExcludedAppPath,
  outputName,
  publishedVersions,
  renderEnvExample,
  templateName,
  transformCompose,
  transformDockerfile,
} from "./sync-templates.mjs";

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
    ["docker/api.Dockerfile", "docker/api.Dockerfile"],
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
    "COPY scripts ./scripts",
    "RUN pnpm --filter qcms-api... build",
  ].join("\n");

  it("drops the two COPY lines that name directories the scaffold has not got", () => {
    expect(SOURCE).toContain("COPY packages ./packages");
    const result = transformDockerfile(SOURCE, "qcms-api");
    expect(result).not.toContain("COPY packages ./packages");
    expect(result).not.toContain("COPY scripts ./scripts");
    expect(result).toContain("COPY apps ./apps");
  });

  it("rewrites the workspace-dependency build into a plain one", () => {
    expect(transformDockerfile(SOURCE, "qcms-api")).toContain("RUN pnpm --filter qcms-api build");
  });

  it("throws rather than silently doing nothing when the anchor is gone", () => {
    expect(() => transformDockerfile("FROM node:24", "qcms-api")).toThrow(/no longer contains/);
  });
});

describe("transformCompose", () => {
  it("adds the 2FA passthrough to both services that read it", () => {
    const source = [
      "  api:",
      "    environment:",
      "      QCMS_MOUNT: all",
      "  admin:",
      "    environment:",
      "      QCMS_ADMIN_TRUSTED_PROXY_HOPS: ${QCMS_ADMIN_TRUSTED_PROXY_HOPS:-1}",
    ].join("\n");
    expect(source).not.toContain("QCMS_ADMIN_2FA");
    const result = transformCompose(source);
    expect(result.match(/QCMS_ADMIN_2FA: \$\{QCMS_ADMIN_2FA:-required\}/g)).toHaveLength(2);
    expect(result).toContain("      QCMS_ADMIN_2FA:");
  });

  it("throws rather than guessing when an anchor is gone", () => {
    expect(() => transformCompose("services: {}")).toThrow(/anchor/);
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
