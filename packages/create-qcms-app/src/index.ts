/**
 * The scaffolder's public surface (task 037).
 *
 * Exported so the CLI e2e and the drift gate can drive it in process rather than by
 * spawning a binary and parsing its output. Nothing here is a stability promise to
 * adopters: `create-qcms-app` is a command, and the command is the contract.
 */

export { fillEnv, generateSecret, type FilledEnv } from "./env-file.js";
export {
  DEFAULTS,
  DEPLOYMENT_SHAPES,
  PACKAGE_MANAGERS,
  TWO_FACTOR_POLICIES,
  helpText,
  normalizeBaseUrl,
  parseArguments,
  resolveTarget,
  validateBaseUrl,
  validateProjectName,
  withDefaults,
  type DeploymentShape,
  type PackageManager,
  type ParseResult,
  type PartialOptions,
  type ScaffoldOptions,
  type TwoFactorPolicy,
} from "./options.js";
export { nextCommands, nextSteps } from "./next-steps.js";
export { PNPM_SPEC, renderTemplate, templateValues } from "./render.js";
export { main } from "./run.js";
export { answeredEnv, scaffold, TargetNotEmpty, type ScaffoldResult } from "./scaffold.js";
export {
  outputPath,
  readTemplate,
  templateFiles,
  TEMPLATE_ROOT,
  type TemplateFile,
} from "./templates.js";
