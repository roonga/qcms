/**
 * The frozen action-kind registry. A kind here is proposable; a name outside it is refused
 * at the propose tool, and nothing can graft one on at runtime.
 */

import { closeForm, reopenForm, updateFormSettings } from "./forms.js";
import { mintLinks, revokeLink } from "./links.js";
import { publishForm, releaseVersion } from "./releases.js";
import type { ActionKindDef } from "./types.js";

const DEFS: readonly ActionKindDef[] = [
  publishForm,
  releaseVersion,
  updateFormSettings,
  closeForm,
  reopenForm,
  mintLinks,
  revokeLink,
];

export const ACTION_KINDS: Readonly<Record<string, ActionKindDef>> = Object.freeze(
  Object.fromEntries(DEFS.map((def) => [def.kind, def])),
);

export const ACTION_KIND_NAMES: readonly string[] = DEFS.map((def) => def.kind);

export function isActionKind(name: string): boolean {
  return Object.hasOwn(ACTION_KINDS, name);
}

export function actionKind(name: string): ActionKindDef | undefined {
  return isActionKind(name) ? ACTION_KINDS[name] : undefined;
}

/** The kind whose route a request matched, which is what the token's step is checked against. */
export function actionKindForRoute(method: string, path: string): ActionKindDef | undefined {
  return DEFS.find((def) => def.route.method === method.toUpperCase() && def.route.path === path);
}
