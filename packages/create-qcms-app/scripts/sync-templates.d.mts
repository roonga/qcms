/**
 * Hand-written types for `sync-templates.mjs`, so `sync-templates.test.ts` can import
 * it under the workspace's `strict` settings.
 *
 * The same arrangement `scripts/check-admin-theme.d.mts` and
 * `scripts/check-fixture-domain.d.mts` use at the repository root: the generator
 * itself stays plain JavaScript (it has to run before anything is built, including
 * itself), and this file is the surface its test compiles against. Only what the test
 * touches is declared; the module has more exports than this.
 */

export declare const REPOSITORY_ROOT: string;
export declare const TEMPLATE_DIR: string;

export declare function isExcludedAppPath(path: string): boolean;
export declare function templateName(path: string): string;
export declare function outputName(path: string): string;
export declare function publishedVersions(): Record<string, string>;
export declare function appManifest(
  app: "api" | "portal" | "admin",
  versions: Record<string, string>,
): Record<string, unknown>;
export declare function assertImports(tree: Map<string, string>): void;
export declare function transformDockerfile(text: string, app: string, role: string): string;
export declare function assertComposeForwardsTwoFactor(text: string): string;
export declare function serviceBlocks(text: string): Map<string, string>;
export declare function assertNoEscapingPaths(tree: Map<string, string>): void;
export declare function assertComposeReferences(tree: Map<string, string>): void;
export declare function assertReadmeClaims(tree: Map<string, string>): void;
export declare function composeInvocations(text: string): string[][];
export declare function composeTarget(words: string[]): {
  service: string | undefined;
  files: string[];
};
export declare function countInternalReferences(tree: Map<string, string>): {
  files: number;
  lines: number;
};
export declare const GIT_BIN_OVERRIDE_ENV_VAR: string;
export declare function checkedGitOverride(value: string): string;
export declare function walk(root: string, base?: string): string[];
export declare function normalizeSeamBlock(block: string): string;
export declare function renderEnvExample(
  composeFiles: { text: string; alwaysRuns: boolean }[],
): string;
export declare function buildTemplates(): Map<string, string>;
export declare function diffTrees(
  expected: Map<string, string>,
  actual: Map<string, string>,
): string[];
export declare function main(args?: string[]): number;
