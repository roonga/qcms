/** Where a workspace switch lands. An authored item never exists in two workspaces, so the area's list is the only honest destination. */

import {
  FIRST_WORKSPACE_SECTION,
  WORKSPACE_SECTIONS,
  WORKSPACES_ROOT,
  workspaceSectionHref,
  type WorkspaceSection,
} from "../membership/sections.ts";

import { AUTHORING_PATH, declaredMode, OPERATIONS_PATH } from "./modes.ts";

const FORMS_PATH = "/forms";

function sectionOf(pathname: string): WorkspaceSection {
  const segments = pathname.split("/").filter((segment) => segment !== "");
  const named = segments[2];
  return WORKSPACE_SECTIONS.find((section) => section === named) ?? FIRST_WORKSPACE_SECTION;
}

/** Operations keeps the environment it is working in; every other filter and the page position go. */
function operationsLanding(search: string): string {
  const environment = new URLSearchParams(search).get("env");
  return environment === null || environment === ""
    ? OPERATIONS_PATH
    : `${OPERATIONS_PATH}?env=${encodeURIComponent(environment)}`;
}

export function workspaceSwitchTarget(input: {
  readonly pathname: string;
  /** The current query, with or without its leading `?`. */
  readonly search: string;
  readonly workspaceId: string;
}): string {
  const { pathname, search, workspaceId } = input;
  if (pathname === WORKSPACES_ROOT || pathname.startsWith(`${WORKSPACES_ROOT}/`)) {
    return workspaceSectionHref(workspaceId, sectionOf(pathname));
  }
  const mode = declaredMode(pathname);
  if (mode === "operations") return operationsLanding(search);
  if (pathname === FORMS_PATH || pathname.startsWith(`${FORMS_PATH}/`)) return FORMS_PATH;
  if (mode === "normal") return AUTHORING_PATH;
  /** A personal route belongs to no area, so the switch only changes which workspace it reports. */
  return pathname;
}
