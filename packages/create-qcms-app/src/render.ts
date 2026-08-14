/**
 * Placeholder rendering, and the package-manager-shaped values that feed it (037).
 *
 * The template language is deliberately one construct, `{{name}}`, with no
 * conditionals and no loops. A scaffolder that grows a template language grows a
 * second product; anything a condition would express is instead a whole file in the
 * `solo/` or `enterprise/` overlay, where it is readable as the file it becomes.
 *
 * An unknown placeholder throws rather than rendering empty. A silently blank value
 * is the failure mode that ships a broken `.env` or a manifest with no name in it,
 * and it looks exactly like success.
 */

import { PACKAGE_MANAGER_RATIONALE, type PackageManager, type ScaffoldOptions } from "./options.js";

/**
 * The pnpm release the scaffolded project pins.
 *
 * Held here rather than read from the QCMS root manifest, because the published CLI
 * has no repository around it. The `PNPM_SPEC` suite in `render.test.ts` asserts it
 * equals the value in the repository root's `packageManager` field, so the two cannot
 * drift.
 */
export const PNPM_SPEC = "pnpm@11.18.0";

/** How each package manager spells the commands the README prints. */
interface PackageManagerCommands {
  readonly installCommand: string;
  readonly runPrefix: string;
  readonly recursiveBuild: string;
  readonly recursiveTypecheck: string;
  /** The `"packageManager"` manifest line, including its trailing comma and newline. */
  readonly packageManagerField: string;
  /** The `"workspaces"` manifest line, for the two managers that need one. */
  readonly workspacesField: string;
}

/**
 * One entry, and the shape is kept rather than inlined because #449 will restore the
 * others once the images can build without a `pnpm-lock.yaml`.
 *
 * `packageManagerField` is never empty here, and that is load-bearing rather than
 * incidental: the Dockerfiles run `corepack enable` and then `pnpm install`, so
 * without a pinned `packageManager` corepack has nothing to resolve and an arbitrary
 * pnpm major runs against a `pnpm-workspace.yaml` that uses pnpm-11-only `allowBuilds`
 * syntax. That was the third npm/yarn breakage, and it is why an empty field must not
 * come back with the other two managers.
 */
const COMMANDS: Readonly<Record<PackageManager, PackageManagerCommands>> = {
  pnpm: {
    installCommand: "pnpm install",
    runPrefix: "pnpm",
    recursiveBuild: "pnpm -r build",
    recursiveTypecheck: "pnpm -r typecheck",
    packageManagerField: `  "packageManager": "${PNPM_SPEC}",\n`,
    workspacesField: "",
  },
};

/** Every value a `.tmpl` file may reference. */
export function templateValues(options: ScaffoldOptions): Readonly<Record<string, string>> {
  const commands = COMMANDS[options.packageManager];
  return {
    projectName: options.projectName,
    packageManager: options.packageManager,
    shape: options.shape,
    adminTwoFactor: options.adminTwoFactor,
    portalBaseUrl: options.portalBaseUrl,
    adminBaseUrl: options.adminBaseUrl,
    packageManagerRationale: PACKAGE_MANAGER_RATIONALE,
    ...commands,
  };
}

const PLACEHOLDER = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;

/** Substitute every `{{name}}`, refusing any name the caller did not supply. */
export function renderTemplate(
  text: string,
  values: Readonly<Record<string, string>>,
  origin: string,
): string {
  return text.replaceAll(PLACEHOLDER, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(
        `${origin} references the placeholder {{${name}}}, which the scaffolder does not define. ` +
          `Known placeholders: ${Object.keys(values).sort().join(", ")}.`,
      );
    }
    return value;
  });
}
