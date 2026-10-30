/**
 * The shell's registered modes, and the route table that resolves one.
 *
 * The mode is looked up from the route here, so no menu or header decides what the shell
 * is in by matching strings of its own.
 */

export const SHELL_MODES = ["normal", "operations", "workspaces"] as const;
export type ShellMode = (typeof SHELL_MODES)[number];

/** A mode that hides the normal menus, so its own header has a name to state. */
export type FocusedShellMode = Exclude<ShellMode, "normal">;

/** The areas `GET /admin/me/access` projects, as the navigation reads them. */
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
  /** Where entering the mode lands when it has nothing remembered. */
  readonly landing: string;
  /** Whether the mode hides the normal application menus. */
  readonly focused: boolean;
  /**
   * The capabilities that admit a caller, any one of them. Empty on normal, which is not
   * an area a caller is admitted to: its routes decide for themselves.
   */
  readonly capabilities: readonly (keyof ShellCapabilities)[];
  /** Route prefixes the mode owns. The longest match wins. */
  readonly routes: readonly string[];
}

const DEFINITIONS: readonly ModeDefinition[] = [
  {
    mode: "operations",
    landing: OPERATIONS_PATH,
    focused: true,
    // The installation claim holds no operational cell and so discovers no form, but the
    // two global queues below are its own destinations, so it is admitted to the mode.
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

/**
 * Routes belonging to whoever is signed in rather than to an area, so opening one keeps
 * the mode it was opened from.
 */
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

/** Whether the route belongs to the signed-in account rather than to one area. */
export function isPersonalRoute(pathname: string): boolean {
  return longestMatch(pathname, PERSONAL_ROUTES) !== undefined;
}

/** The mode the route itself declares, or `undefined` for a personal or unknown route. */
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

/**
 * The mode the shell renders. A personal route keeps the remembered focused mode, so
 * reading an account setting inside Operations does not reveal the normal menus.
 */
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

/** The mode when it hides the normal application menus, and `undefined` when it does not. */
export function focusedMode(mode: ShellMode): FocusedShellMode | undefined {
  if (!definitionFor(mode).focused) return undefined;
  return mode === "normal" ? undefined : mode;
}

export function landingPathForMode(mode: ShellMode): string {
  return definitionFor(mode).landing;
}

/**
 * The areas this caller may be admitted to, in navigation order. Normal is one only when
 * they can author: it is where the Questions and Forms menus go.
 */
export function permittedAreas(capabilities: ShellCapabilities): readonly ShellMode[] {
  const areas: ShellMode[] = [];
  if (capabilities.authoring) areas.push("normal");
  // The real operational cells, not the admission rule: the installation claim discovers
  // no form, so landing it on an empty table would be a worse answer than its own area.
  if (capabilities.operations) areas.push("operations");
  if (capabilities.workspaces) areas.push("workspaces");
  return areas;
}

/** Whether a caller may deliberately enter the mode. */
export function permitsMode(capabilities: ShellCapabilities, mode: ShellMode): boolean {
  const admitting = definitionFor(mode).capabilities;
  if (admitting.length === 0) return true;
  return admitting.some((capability) => capabilities[capability]);
}

/**
 * Which area a caller lands in with no route of their own, or `undefined` when they hold
 * none and so get My access rather than a fabricated authoring screen.
 */
export function landingArea(capabilities: ShellCapabilities): ShellMode | undefined {
  return permittedAreas(capabilities)[0];
}

/** {@link landingArea} as a path, for a caller with no remembered context to restore. */
export function landingPath(capabilities: ShellCapabilities): string {
  const first = landingArea(capabilities);
  return first === undefined ? MY_ACCESS_PATH : landingPathForMode(first);
}

/**
 * Which area an explicit Exit leaves for, or `undefined` when the caller has no other
 * permitted area and so is offered none. The caller turns it into a path, so a remembered
 * context is restored by the one function that knows about them.
 */
export function exitMode(from: ShellMode, capabilities: ShellCapabilities): ShellMode | undefined {
  return permittedAreas(capabilities).find((area) => area !== from);
}

/**
 * Whether a caller may be on this route. Only a focused mode's routes are gated here;
 * every other route decides on the server for itself.
 */
export function permitsPath(capabilities: ShellCapabilities, pathname: string): boolean {
  const declared = declaredMode(pathname);
  if (declared === undefined) return true;
  return permitsMode(capabilities, declared);
}
