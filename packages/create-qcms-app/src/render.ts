/**
 * Placeholder rendering, and the values that feed it (037).
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

import { PACKAGE_MANAGER_RATIONALE, type ScaffoldOptions } from "./options.js";

/**
 * The pnpm release the scaffolded project pins.
 *
 * Held here rather than read from the QCMS root manifest, because the published CLI
 * has no repository around it. The `PNPM_SPEC` suite in `render.test.ts` asserts it
 * equals the value in the repository root's `packageManager` field, so the two cannot
 * drift.
 */
export const PNPM_SPEC = "pnpm@11.18.0";

/**
 * How the scaffolded project spells the commands its README prints.
 *
 * Flat constants rather than a record keyed by package manager. The record existed to
 * hold three entries, two of which produced a project whose images could not build,
 * and the Code Owner dropped them (issue #449). Keeping the shape "in case #449 comes
 * back" would keep a branch nothing takes and a `workspacesField` nothing sets, which
 * is how a dead path survives a review: restoring the choice means restoring the
 * Dockerfile work first, and the shape is the smallest part of that.
 *
 * `installCommand` and `runPrefix` went the same way. With one manager they rendered
 * the literal word `pnpm`, and interpolating a constant into a README only cost that
 * README its column alignment. What survives is what actually varies with the manager:
 * the two recursive scripts and the `packageManager` pin.
 *
 * `packageManagerField` is never empty, and that is load-bearing rather than
 * incidental: the Dockerfiles run `corepack enable` and then `pnpm install`, so
 * without a pinned `packageManager` corepack has nothing to resolve and an arbitrary
 * pnpm major runs against a `pnpm-workspace.yaml` that uses pnpm-11-only `allowBuilds`
 * syntax.
 */
const COMMANDS = {
  recursiveBuild: "pnpm -r build",
  recursiveTypecheck: "pnpm -r typecheck",
  packageManagerField: `  "packageManager": "${PNPM_SPEC}",\n`,
} as const;

/** Every value a `.tmpl` file may reference. */
export function templateValues(options: ScaffoldOptions): Readonly<Record<string, string>> {
  return {
    projectName: options.projectName,
    shape: options.shape,
    adminTwoFactor: options.adminTwoFactor,
    portalBaseUrl: options.portalBaseUrl,
    adminBaseUrl: options.adminBaseUrl,
    packageManagerRationale: PACKAGE_MANAGER_RATIONALE,
    ...COMMANDS,
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
