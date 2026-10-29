/**
 * One construct, `{{name}}`; anything conditional is a whole file in a shape overlay.
 * An unknown placeholder throws, since a silent blank ships a broken `.env`.
 */

import { PACKAGE_MANAGER_RATIONALE, type ScaffoldOptions } from "./options.js";

/** Pinned here because the published CLI has no repository around it; `render.test.ts` checks it against the root `packageManager`. */
export const PNPM_SPEC = "pnpm@11.18.0";

/** `packageManagerField` is never empty: corepack needs it to pick a pnpm that accepts `allowBuilds`. */
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
