/**
 * What the scaffolder needs to know, and how it learns it (task 037).
 *
 * Two entry paths, one shape: {@link parseArguments} reads flags (the CI path,
 * `--yes`), {@link promptMissing} asks for whatever the flags left open (the human
 * path). Both produce the same {@link ScaffoldOptions}, so the scaffolder itself has
 * no idea which one ran and nothing can be reachable interactively but not by flag.
 */

import { basename, isAbsolute, resolve } from "node:path";

/** Deployment shapes the scaffold knows how to stamp. */
export const DEPLOYMENT_SHAPES = ["solo", "enterprise"] as const;
export type DeploymentShape = (typeof DEPLOYMENT_SHAPES)[number];

/**
 * The one package manager the scaffold installs with.
 *
 * **There is no choice, decided by the Code Owner (task 037 review, issue #449, and
 * again on 2026-09-03).** The three shipped Dockerfiles prune their runtime tree with
 * `pnpm deploy --legacy --prod`, which has no npm or yarn equivalent, and they install
 * from a `pnpm-lock.yaml` that an npm or yarn scaffold never produces. Offering the
 * other two produced a project whose `docker compose up --build` failed at a `COPY`
 * with an error that named a missing lockfile rather than the choice that caused it.
 *
 * An answer that builds nothing is a promise the tool does not keep, so the prompt,
 * the flag's alternatives and the per-manager rendering are gone rather than narrowed:
 * there is no shape left for a broken path to hide in. #449 stays open as the
 * follow-up that restores the choice once the images can build without a
 * `pnpm-lock.yaml`.
 */
export const PACKAGE_MANAGER = "pnpm";

/**
 * Why there is no choice, in one sentence, wherever an adopter meets it.
 *
 * Held here so the CLI's output and the scaffolded READMEs cannot say different
 * things; `render.test.ts` asserts the READMEs carry it.
 */
export const PACKAGE_MANAGER_RATIONALE =
  "QCMS scaffolds a pnpm workspace: the shipped Dockerfiles prune their runtime tree with `pnpm deploy --legacy --prod`, which has no npm or yarn equivalent.";

/** Admin 2FA policies, matching `QCMS_ADMIN_2FA` in the API configuration schema. */
export const TWO_FACTOR_POLICIES = ["required", "optional"] as const;
export type TwoFactorPolicy = (typeof TWO_FACTOR_POLICIES)[number];

/** Defaults the `--yes` path uses, and the values the prompts offer. */
export const DEFAULTS = {
  projectName: "my-forms",
  shape: "solo",
  adminTwoFactor: "required",
  // Seat 0's portal and admin ports from the QCMS allocation (R8, docs/PORTS.md),
  // which is also what `docker-compose.yml` publishes by default.
  portalBaseUrl: "http://localhost:7000",
  adminBaseUrl: "http://localhost:7040",
} as const;

/** Everything the scaffolder needs, fully resolved. */
export interface ScaffoldOptions {
  readonly projectName: string;
  /** Absolute path of the directory to create. */
  readonly targetDirectory: string;
  readonly shape: DeploymentShape;
  readonly adminTwoFactor: TwoFactorPolicy;
  readonly portalBaseUrl: string;
  readonly adminBaseUrl: string;
  /** Run the package manager's install after stamping. */
  readonly install: boolean;
  /** Initialise a git repository and make the first commit. */
  readonly git: boolean;
  /** Stamp into a directory that already has files in it. */
  readonly force: boolean;
}

/** A partially answered set: flags given, prompts still to run. */
export type PartialOptions = Partial<ScaffoldOptions>;

/** What `parseArguments` decided to do. */
export type ParseResult =
  | { readonly kind: "options"; readonly options: PartialOptions; readonly assumeYes: boolean }
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | { readonly kind: "error"; readonly message: string };

/**
 * npm's own package-name rule, narrowed: the value becomes a directory name, the
 * root manifest's `name`, and the Compose project name, so anything a shell or a
 * path would have to quote is refused rather than escaped three different ways.
 */
const PROJECT_NAME = /^[a-z0-9][a-z0-9._-]*$/;

/** Reject a project name that cannot be a directory, a package name and a Compose project. */
export function validateProjectName(name: string): string | undefined {
  if (name === "") return "The project name cannot be empty.";
  if (name.length > 214) return "The project name must be at most 214 characters.";
  if (!PROJECT_NAME.test(name)) {
    return `"${name}" is not a usable project name. Use lowercase letters, digits, dots, hyphens and underscores, starting with a letter or digit.`;
  }
  return undefined;
}

/** Reject a base URL that is not an absolute http(s) origin. */
export function validateBaseUrl(value: string, label: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${label} must be an absolute URL, for example ${DEFAULTS.portalBaseUrl}`;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `${label} must use http or https, not ${url.protocol.replace(":", "")}`;
  }
  return undefined;
}

/** Strip a single trailing slash, the way the API's own URL parser does. */
export function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function isMember<T extends string>(values: readonly T[], candidate: string): candidate is T {
  return (values as readonly string[]).includes(candidate);
}

/** One `--flag value` pair, validated into the options it sets. */
function applyFlag(flag: string, value: string, into: Record<string, unknown>): string | undefined {
  switch (flag) {
    // The flag survives the dropping of the choice (issue #449) for one reason: an
    // adopter who types `--package-manager npm` meets the constraint and the reason
    // for it, rather than "Unknown option". `pnpm` is accepted as a no-op, so an
    // invocation written before the choice was dropped still runs; it sets nothing,
    // because there is nothing left for it to set.
    case "--package-manager":
      if (value !== PACKAGE_MANAGER) {
        return `--package-manager only accepts ${PACKAGE_MANAGER}. ${PACKAGE_MANAGER_RATIONALE}`;
      }
      return undefined;
    case "--shape":
      if (!isMember(DEPLOYMENT_SHAPES, value)) {
        return `--shape must be one of ${DEPLOYMENT_SHAPES.join(", ")}`;
      }
      into["shape"] = value;
      return undefined;
    case "--admin-2fa":
      if (!isMember(TWO_FACTOR_POLICIES, value)) {
        return `--admin-2fa must be one of ${TWO_FACTOR_POLICIES.join(", ")}`;
      }
      into["adminTwoFactor"] = value;
      return undefined;
    case "--portal-base-url":
      return applyUrlFlag(value, "--portal-base-url", "portalBaseUrl", into);
    case "--admin-base-url":
      return applyUrlFlag(value, "--admin-base-url", "adminBaseUrl", into);
    default:
      return `Unknown option ${flag}. Run with --help for the full list.`;
  }
}

function applyUrlFlag(
  value: string,
  flag: string,
  key: string,
  into: Record<string, unknown>,
): string | undefined {
  const problem = validateBaseUrl(value, flag);
  if (problem !== undefined) return problem;
  into[key] = normalizeBaseUrl(value);
  return undefined;
}

/** Boolean flags, each mapping to one option. */
const BOOLEAN_FLAGS: Readonly<Record<string, readonly [string, boolean]>> = {
  "--no-install": ["install", false],
  "--no-git": ["git", false],
  "--force": ["force", true],
};

/** What reading one flag decided: keep going (having eaten `consumed` extra words), or stop. */
type FlagOutcome = { readonly kind: "ok"; readonly consumed: number } | ParseResult;

/** Mutable scratch the flag reader writes into. */
interface ParseState {
  assumeYes: boolean;
}

function readFlag(
  argument: string,
  next: string | undefined,
  into: Record<string, unknown>,
  state: ParseState,
): FlagOutcome {
  if (argument === "--help" || argument === "-h") return { kind: "help" };
  if (argument === "--version" || argument === "-v") return { kind: "version" };
  if (argument === "--yes" || argument === "-y") {
    state.assumeYes = true;
    return { kind: "ok", consumed: 0 };
  }
  const boolean = BOOLEAN_FLAGS[argument];
  if (boolean !== undefined) {
    into[boolean[0]] = boolean[1];
    return { kind: "ok", consumed: 0 };
  }
  const [flag, inline] = splitFlag(argument);
  const value = inline ?? next;
  if (value === undefined) return { kind: "error", message: `${flag} needs a value.` };
  const problem = applyFlag(flag, value, into);
  if (problem !== undefined) return { kind: "error", message: problem };
  return { kind: "ok", consumed: inline === undefined ? 1 : 0 };
}

/**
 * Read the command line.
 *
 * The first non-flag argument is the project name, which is what makes
 * `pnpm create qcms-app my-forms` work: npm-init passes the trailing words through.
 */
export function parseArguments(argv: readonly string[], cwd: string): ParseResult {
  const into: Record<string, unknown> = {};
  const state: ParseState = { assumeYes: false };
  let projectName: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (!argument.startsWith("-")) {
      if (projectName !== undefined) {
        return { kind: "error", message: `Unexpected extra argument "${argument}".` };
      }
      projectName = argument;
      continue;
    }
    const outcome = readFlag(argument, argv[index + 1], into, state);
    if (outcome.kind !== "ok") return outcome;
    index += outcome.consumed;
  }

  if (projectName !== undefined) {
    // The argument is a DIRECTORY, and the project name is its last segment. That
    // split matters for `create-qcms-app /tmp/scratch/my-forms`, which every
    // scaffolder accepts and which would otherwise be validated as a package name
    // and refused for containing slashes.
    const directory = resolveTarget(projectName, cwd);
    const name = basename(directory);
    const problem = validateProjectName(name);
    if (problem !== undefined) return { kind: "error", message: problem };
    into["projectName"] = name;
    into["targetDirectory"] = directory;
  }
  return { kind: "options", options: into, assumeYes: state.assumeYes };
}

/** `--flag=value` into its two halves; `--flag` keeps an undefined value. */
function splitFlag(argument: string): readonly [string, string | undefined] {
  const equals = argument.indexOf("=");
  if (equals === -1) return [argument, undefined];
  return [argument.slice(0, equals), argument.slice(equals + 1)];
}

/** Where a project name lands on disk. */
export function resolveTarget(projectName: string, cwd: string): string {
  return isAbsolute(projectName) ? projectName : resolve(cwd, projectName);
}

/** Fill every unanswered option with its default. */
export function withDefaults(partial: PartialOptions, cwd: string): ScaffoldOptions {
  const projectName = partial.projectName ?? DEFAULTS.projectName;
  return {
    projectName,
    targetDirectory: partial.targetDirectory ?? resolveTarget(projectName, cwd),
    shape: partial.shape ?? DEFAULTS.shape,
    adminTwoFactor: partial.adminTwoFactor ?? DEFAULTS.adminTwoFactor,
    portalBaseUrl: partial.portalBaseUrl ?? DEFAULTS.portalBaseUrl,
    adminBaseUrl: partial.adminBaseUrl ?? DEFAULTS.adminBaseUrl,
    install: partial.install ?? true,
    git: partial.git ?? true,
    force: partial.force ?? false,
  };
}

/**
 * Greedy wrap at 76 columns, so the one shared sentence reads in a terminal.
 *
 * `PACKAGE_MANAGER_RATIONALE` is one string used in three places: this text, the
 * `--package-manager` refusal, and both scaffolded READMEs. Markdown reflows it and a
 * terminal does not, so the wrapping belongs here rather than in the constant, which
 * would put hard line breaks into the READMEs.
 */
function wrap(text: string, width = 76): string {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    if (current === "") current = word;
    else if (`${current} ${word}`.length <= width) current = `${current} ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines.join("\n");
}

/** The `--help` text. */
export function helpText(): string {
  return `Usage: create-qcms-app [directory] [options]

Scaffold a QCMS deployment: the application shell you own, over the versioned
@qcms/* packages you upgrade.

${wrap(PACKAGE_MANAGER_RATIONALE)}

Options:
  -y, --yes                  Take every default; ask nothing. The CI path.
      --package-manager      ${PACKAGE_MANAGER}, the only value. There is no choice and
                             no prompt; see the sentence above.
      --shape <s>            ${DEPLOYMENT_SHAPES.join(" | ")} (default ${DEFAULTS.shape})
      --admin-2fa <p>        ${TWO_FACTOR_POLICIES.join(" | ")} (default ${DEFAULTS.adminTwoFactor})
      --portal-base-url <u>  Public origin of the respondent portal
      --admin-base-url <u>   Public origin of the authoring admin
      --no-install           Stamp the files, install nothing
      --no-git               Do not initialise a git repository
      --force                Stamp into a directory that already has files
  -h, --help                 Show this message
  -v, --version              Show the version

Example:
  pnpm create qcms-app my-forms
`;
}
