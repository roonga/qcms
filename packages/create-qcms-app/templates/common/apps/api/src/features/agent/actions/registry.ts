/**
 * The frozen action-kind registry. A kind here is proposable; a name outside it is refused
 * at the propose tool, and nothing can graft one on at runtime.
 */

import { closeForm, reopenForm, updateFormSettings } from "./forms.js";
import { createForm } from "./forms-library.js";
import { mintLinks, revokeLink } from "./links.js";
import {
  createAccessGroup,
  grantAccessGroup,
  removeAccessGroup,
  revokeAccessGroup,
  saveWorkspaceSettings,
  setMemberRole,
} from "./membership.js";
import {
  createQuestion,
  deprecateQuestionVersion,
  newQuestionVersion,
  publishQuestionVersion,
  saveQuestionDraft,
} from "./questions.js";
import { publishForm, releaseVersion } from "./releases.js";
import { eraseResponse, exportResponses, unflagResponse } from "./responses.js";
import type { ActionKindDef } from "./types.js";
import {
  createWebhook,
  deactivateWebhook,
  reactivateWebhook,
  redeliverDelivery,
  retargetWebhook,
  rotateWebhookSecret,
} from "./webhooks.js";

const DEFS: readonly ActionKindDef[] = [
  createForm,
  publishForm,
  releaseVersion,
  updateFormSettings,
  closeForm,
  reopenForm,
  mintLinks,
  revokeLink,
  eraseResponse,
  unflagResponse,
  exportResponses,
  createWebhook,
  rotateWebhookSecret,
  retargetWebhook,
  reactivateWebhook,
  deactivateWebhook,
  redeliverDelivery,
  createAccessGroup,
  removeAccessGroup,
  grantAccessGroup,
  revokeAccessGroup,
  setMemberRole,
  saveWorkspaceSettings,
  createQuestion,
  saveQuestionDraft,
  publishQuestionVersion,
  deprecateQuestionVersion,
  newQuestionVersion,
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

function sameMembers(want: readonly string[], got: readonly string[]): boolean {
  return want.length === got.length && want.every((member) => got.includes(member));
}

/**
 * The kind whose route a request matched, which is what the token's step is checked
 * against. Where one route and method serve several acts, the body's own member set
 * chooses between them, and a set no kind declares resolves to none.
 */
export function actionKindForRoute(
  method: string,
  path: string,
  body?: unknown,
): ActionKindDef | undefined {
  // A hand-off is excluded rather than matched: it carries no token, so a token naming
  // one can only be a forgery and is refused with the route code.
  const candidates = DEFS.filter(
    (def) =>
      def.handOff !== true && def.route?.method === method.toUpperCase() && def.route.path === path,
  );
  const first = candidates[0];
  if (first === undefined || (candidates.length === 1 && first.route?.bodyMembers === undefined)) {
    return first;
  }
  const members = typeof body === "object" && body !== null ? Object.keys(body) : [];
  return candidates.find(
    (def) => def.route?.bodyMembers !== undefined && sameMembers(def.route.bodyMembers, members),
  );
}
