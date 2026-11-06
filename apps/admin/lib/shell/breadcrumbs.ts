import { t, type MessageKey } from "../i18n/en.ts";
import {
  ALL_WORKSPACES_SEGMENT,
  WORKSPACE_SECTION_LABELS,
  WORKSPACE_SECTIONS,
  workspaceHref,
  type WorkspaceSection,
} from "../membership/sections.ts";

export interface Crumb {
  readonly label: string;
  /** Absent on the current page and on an item with no screen of its own. */
  readonly href?: string;
  /** An identifier the page shows in a monospaced face. */
  readonly code?: boolean;
}

/** The names a trail cannot read from the address, supplied by the screen's rail. */
export interface CrumbNames {
  readonly form?: string;
  readonly workspace?: string;
}

const FORM_SECTIONS: Readonly<Record<string, MessageKey>> = {
  rules: "forms.tab.rules",
  preview: "forms.tab.preview",
  versions: "forms.tab.versions",
  publish: "forms.tab.publish",
};

const OPERATIONS_SECTIONS: Readonly<Record<string, MessageKey>> = {
  responses: "forms.tab.responses",
  links: "forms.tab.links",
  webhooks: "forms.tab.webhooks",
  intake: "forms.tab.intake",
  erase: "forms.tab.erase",
};

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isWorkspaceSection(value: string): value is WorkspaceSection {
  return (WORKSPACE_SECTIONS as readonly string[]).includes(value);
}

function questions(rest: readonly string[]): Crumb[] {
  const area: Crumb = { label: t("nav.questions"), href: "/questions" };
  const [item] = rest;
  if (item === undefined) return [area];
  if (item === "new") return [area, { label: t("questions.create.title") }];
  return [area, { label: decode(item), code: true }];
}

function forms(rest: readonly string[], names: CrumbNames): Crumb[] {
  const area: Crumb = { label: t("nav.forms"), href: "/forms" };
  const [formId, section, version] = rest;
  if (formId === undefined) return [area];
  if (formId === "new") return [area, { label: t("forms.create.title") }];
  const base = `/forms/${encodeURIComponent(decode(formId))}`;
  const form: Crumb = { label: names.form ?? decode(formId), href: base };
  if (section === undefined) return [area, form, { label: t("forms.tab.builder") }];
  const key = FORM_SECTIONS[section];
  if (key === undefined) return [area, form];
  if (section === "versions" && version !== undefined) {
    return [
      area,
      form,
      { label: t(key), href: `${base}/${section}` },
      { label: t("forms.history.versionHeading", { version: decode(version) }) },
    ];
  }
  return [area, form, { label: t(key) }];
}

/* The top bar's Operations group names the area, so the trail starts below it. */
function operations(rest: readonly string[], names: CrumbNames): Crumb[] {
  const [kind, formId, context, sessionId] = rest;
  if (kind !== "forms" || formId === undefined) return [];
  const form: Crumb = { label: names.form ?? decode(formId) };
  const key = context === undefined ? undefined : OPERATIONS_SECTIONS[context];
  if (key === undefined) return [form];
  if (sessionId !== undefined) {
    const href = `/operations/forms/${encodeURIComponent(decode(formId))}/${context ?? ""}`;
    return [form, { label: t(key), href }, { label: decode(sessionId), code: true }];
  }
  return [form, { label: t(key) }];
}

function workspaces(rest: readonly string[], names: CrumbNames): Crumb[] {
  const area: Crumb = { label: t("nav.workspaces"), href: "/workspaces" };
  const [workspaceId, section] = rest;
  if (workspaceId === undefined) return [area];
  if (workspaceId === ALL_WORKSPACES_SEGMENT) {
    return [area, { label: t("membership.workspace.allWorkspaces") }];
  }
  const id = decode(workspaceId);
  const workspace: Crumb = { label: names.workspace ?? id, href: workspaceHref(id) };
  if (section === undefined || !isWorkspaceSection(section)) return [area, workspace];
  return [area, workspace, { label: t(WORKSPACE_SECTION_LABELS[section]) }];
}

/**
 * The breadcrumb for an address: area, then section, then item. Every crumb but the last
 * links; the last is the page itself.
 */
export function breadcrumbTrail(pathname: string, names: CrumbNames = {}): readonly Crumb[] {
  const segments = pathname.split("/").filter((segment) => segment !== "");
  const [top, ...rest] = segments;
  let trail: Crumb[];
  switch (top) {
    case "questions":
      trail = questions(rest);
      break;
    case "forms":
      trail = forms(rest, names);
      break;
    case "operations":
      trail = operations(rest, names);
      break;
    case "webhooks":
      trail = [{ label: t("operations.queue.deliveryFailures") }];
      break;
    case "responses":
      trail = rest[0] === "erasures" ? [{ label: t("operations.queue.erasureLog") }] : [];
      break;
    case "workspaces":
      trail = workspaces(rest, names);
      break;
    case "settings":
      trail = [{ label: t("settings.title") }];
      break;
    case "me":
      trail = [{ label: t("access.title") }];
      break;
    default:
      trail = [];
  }
  return trail.map((crumb, index) =>
    index === trail.length - 1
      ? { label: crumb.label, ...(crumb.code === true ? { code: true } : {}) }
      : crumb,
  );
}
