export const SHELL_MODES = ["normal", "operations", "workspaces"] as const;
export type ShellMode = (typeof SHELL_MODES)[number];

export type FocusedShellMode = Exclude<ShellMode, "normal">;

export interface ShellCapabilities {
  readonly authoring: boolean;
  readonly operations: boolean;
  readonly workspaces: boolean;
  readonly siteConfiguration: boolean;
}

export const NO_CAPABILITIES: ShellCapabilities = {
  authoring: false,
  operations: false,
  workspaces: false,
  siteConfiguration: false,
};

export const MY_ACCESS_PATH = "/me/access";
export const SETTINGS_PATH = "/settings";
export const OPERATIONS_PATH = "/operations";
export const WORKSPACES_PATH = "/workspaces";
export const AUTHORING_PATH = "/questions";

interface ModeDefinition {
  readonly mode: ShellMode;

  readonly landing: string;

  readonly focused: boolean;

  readonly capabilities: readonly (keyof ShellCapabilities)[];

  readonly routes: readonly string[];
}

const DEFINITIONS: readonly ModeDefinition[] = [
  {
    mode: "operations",
    landing: OPERATIONS_PATH,
    focused: true,
    /** Installation-wide claims discover no operational form but still need their global queue destinations. */
    capabilities: ["operations", "siteConfiguration"],
    routes: [OPERATIONS_PATH, "/responses", "/webhooks"],
  },
  {
    mode: "workspaces",
    landing: WORKSPACES_PATH,
    focused: true,
    capabilities: ["workspaces"],
    routes: [WORKSPACES_PATH],
  },
  {
    mode: "normal",
    landing: AUTHORING_PATH,
    focused: false,
    capabilities: [],
    routes: ["/questions", "/forms"],
  },
];

const PERSONAL_ROUTES: readonly string[] = [SETTINGS_PATH, MY_ACCESS_PATH];

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function longestMatch(pathname: string, prefixes: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const prefix of prefixes) {
    if (!matches(pathname, prefix)) continue;
    if (best === undefined || prefix.length > best.length) best = prefix;
  }
  return best;
}

export function isPersonalRoute(pathname: string): boolean {
  return longestMatch(pathname, PERSONAL_ROUTES) !== undefined;
}

export function declaredMode(pathname: string): ShellMode | undefined {
  if (isPersonalRoute(pathname)) return undefined;
  let best: { readonly mode: ShellMode; readonly length: number } | undefined;
  for (const definition of DEFINITIONS) {
    const prefix = longestMatch(pathname, definition.routes);
    if (prefix === undefined) continue;
    if (best === undefined || prefix.length > best.length) {
      best = { mode: definition.mode, length: prefix.length };
    }
  }
  return best?.mode;
}

export function parseShellMode(raw: string | undefined): ShellMode | undefined {
  return SHELL_MODES.find((mode) => mode === raw);
}

export function modeForPath(pathname: string, remembered: ShellMode | undefined): ShellMode {
  const declared = declaredMode(pathname);
  if (declared !== undefined) return declared;
  if (isPersonalRoute(pathname) && remembered !== undefined) return remembered;
  return "normal";
}

function definitionFor(mode: ShellMode): ModeDefinition {
  const found = DEFINITIONS.find((definition) => definition.mode === mode);
  if (found === undefined) throw new Error(`no shell mode definition for ${mode}`);
  return found;
}

export function focusedMode(mode: ShellMode): FocusedShellMode | undefined {
  if (!definitionFor(mode).focused) return undefined;
  return mode === "normal" ? undefined : mode;
}

export function landingPathForMode(mode: ShellMode): string {
  return definitionFor(mode).landing;
}

export function permittedAreas(capabilities: ShellCapabilities): readonly ShellMode[] {
  const areas: ShellMode[] = [];
  if (capabilities.authoring) areas.push("normal");
  /** Use actual operational cells for landing; admission via an installation claim alone would yield an empty form table. */
  if (capabilities.operations) areas.push("operations");
  if (capabilities.workspaces) areas.push("workspaces");
  return areas;
}

export function permitsMode(capabilities: ShellCapabilities, mode: ShellMode): boolean {
  const admitting = definitionFor(mode).capabilities;
  if (admitting.length === 0) return true;
  return admitting.some((capability) => capabilities[capability]);
}

export function landingArea(capabilities: ShellCapabilities): ShellMode | undefined {
  return permittedAreas(capabilities)[0];
}

export function landingPath(capabilities: ShellCapabilities): string {
  const first = landingArea(capabilities);
  return first === undefined ? MY_ACCESS_PATH : landingPathForMode(first);
}

export function exitMode(from: ShellMode, capabilities: ShellCapabilities): ShellMode | undefined {
  return permittedAreas(capabilities).find((area) => area !== from);
}

/** Do not remember denied modes or let a refused bookmark retarget the next personal route. */
export function rememberableMode(
  pathname: string,
  capabilities: ShellCapabilities,
): ShellMode | undefined {
  const declared = declaredMode(pathname);
  if (declared === undefined) return undefined;
  return permitsMode(capabilities, declared) ? declared : undefined;
}

export function permitsPath(capabilities: ShellCapabilities, pathname: string): boolean {
  const declared = declaredMode(pathname);
  if (declared === undefined) return true;
  return permitsMode(capabilities, declared);
}
