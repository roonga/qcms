import {
  declaredMode,
  isPersonalRoute,
  modeForPath,
  permitsPath,
  type ShellCapabilities,
  type ShellMode,
} from "./modes.ts";

/** Marks the one control that leaves Operations on purpose, so the warning lets it through. */
export const LEAVE_EXEMPT_ATTRIBUTE = "data-qcms-leave-exempt";

/** Per tab, so a second tab's journey never decides where this one's Exit goes. */
export const OPERATIONS_RETURN_KEY = "qcms-operations-return";

export type LeaveDestination = "questions" | "forms" | "workspaces" | "elsewhere";

/**
 * Whether moving from one address to another leaves Operations. Personal routes keep the
 * mode they were opened from, so Settings and My access are movement inside it.
 */
export function leavesOperations(
  from: string,
  to: string,
  remembered: ShellMode | undefined,
): boolean {
  if (modeForPath(from, remembered) !== "operations") return false;
  if (isPersonalRoute(to)) return false;
  return declaredMode(to) !== "operations";
}

/** The area the warning names, so the operator reads where the link goes. */
export function leaveDestination(pathname: string): LeaveDestination {
  const top = pathname.split("/")[1] ?? "";
  if (top === "questions" || top === "forms" || top === "workspaces") return top;
  return "elsewhere";
}

export interface ClickFacts {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly defaultPrevented: boolean;
}

export interface AnchorFacts {
  readonly href: string;
  readonly target: string;
  readonly download: boolean;
  readonly exempt: boolean;
}

/**
 * The same-origin path a plain click on this anchor would open, or `undefined` when the
 * browser is opening something else: a new tab, a download, another origin.
 */
export function plainNavigation(
  click: ClickFacts,
  anchor: AnchorFacts,
  origin: string,
): string | undefined {
  if (click.defaultPrevented || click.button !== 0) return undefined;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return undefined;
  if (anchor.exempt || anchor.download) return undefined;
  if (anchor.target !== "" && anchor.target !== "_self") return undefined;
  let url: URL;
  try {
    url = new URL(anchor.href, origin);
  } catch {
    return undefined;
  }
  if (url.origin !== origin) return undefined;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The address Exit Operations may later return to, or `undefined` when this one is not such a place. */
export function rememberedReturn(pathname: string, search: string): string | undefined {
  if (isPersonalRoute(pathname)) return undefined;
  if (declaredMode(pathname) === "operations") return undefined;
  return `${pathname}${search}`;
}

function hasUnsafeCharacter(address: string): boolean {
  for (let index = 0; index < address.length; index += 1) {
    const code = address.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

/**
 * Where Exit Operations goes: the remembered address when it resolves to a same-origin path
 * outside Operations that this caller may open, otherwise the fallback.
 */
export function operationsExitHref(
  remembered: string | null | undefined,
  capabilities: ShellCapabilities,
  fallback: string,
  origin: string,
): string {
  if (remembered === null || remembered === undefined) return fallback;
  // URL parsing drops tab and newline and reads a backslash as a slash, so "/\t//host" leaves the origin.
  if (!remembered.startsWith("/") || hasUnsafeCharacter(remembered)) return fallback;
  let url: URL;
  try {
    url = new URL(remembered, origin);
  } catch {
    return fallback;
  }
  if (url.origin !== new URL(origin).origin) return fallback;
  if (isPersonalRoute(url.pathname)) return fallback;
  if (declaredMode(url.pathname) === "operations") return fallback;
  if (!permitsPath(capabilities, url.pathname)) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
