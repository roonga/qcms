import { t, type MessageKey } from "../i18n/en.ts";

// Map API codes to catalog copy naming the violated rule; never render upstream developer prose.

const FORM_CODE_MESSAGES: Readonly<Record<string, MessageKey>> = {
  INVALID_FORM_ID: "forms.error.invalidId",
  INVALID_DEFAULT_LOCALE: "forms.error.invalidLocale",
  FORM_ID_TAKEN: "forms.error.idTaken",
  FORM_NOT_FOUND: "forms.error.notFound",
  FORM_ID_MISMATCH: "forms.error.idMismatch",
  INVALID_FORM_DEFINITION: "forms.error.invalidDefinition",
  RULE_NOT_FOUND: "forms.error.ruleNotFound",
  INVALID_FORM_SETTINGS: "forms.error.invalidSettings",

  NO_DRAFT: "forms.error.noDraft",
  PUBLISH_REJECTED: "forms.error.publishRejected",
  PREVIEW_REJECTED: "forms.error.previewRejected",
  PREVIEW_UNAVAILABLE: "forms.error.previewUnavailable",
  VERSION_NOT_FOUND: "forms.error.versionNotFound",
  INVALID_LINK_ID: "forms.error.invalidLinkId",
  LINK_NOT_FOUND: "forms.error.linkNotFound",
  LINK_EXPIRY_INVALID: "forms.error.linkExpiryInvalid",
  // Name the environment because intake refusals apply to one release state, not the entire form.
  NOT_RELEASED: "forms.lifecycle.notReleasedHere",
  ALREADY_CLOSED: "forms.lifecycle.alreadyClosedHere",
  ALREADY_OPEN: "forms.lifecycle.alreadyOpenHere",
  UNKNOWN_ENVIRONMENT: "forms.error.unknownEnvironment",

  INVALID_QUESTION_DEFINITION: "forms.error.proposedQuestionRefused",
  QUESTION_ID_REUSED: "forms.error.proposedQuestionIdReused",
  SLUG_TAKEN: "forms.error.proposedQuestionSlugTaken",
  INVALID_QUERY: "ops.error.invalidQuery",
  INVALID_SESSION_ID: "ops.error.invalidSessionId",
  RESPONSE_NOT_FOUND: "ops.error.responseNotFound",
  SESSION_NOT_FOUND: "ops.error.sessionNotFound",
  SUBMISSION_NOT_FOUND: "ops.error.submissionNotFound",
  WEBHOOK_NOT_FOUND: "ops.error.webhookNotFound",
  WEBHOOK_URL_REJECTED: "ops.error.webhookUrlRejected",
  DELIVERY_NOT_FOUND: "ops.error.deliveryNotFound",
  DELIVERY_NOT_REDELIVERABLE: "ops.error.deliveryNotRedeliverable",
  // Map approval refusals explicitly so users receive the remedy instead of a raw internal token.
  TEST_RELEASE_REQUIRED: "forms.workflow.testRequired",
  APPROVER_IS_AUTHOR: "forms.error.approverIsAuthor",
  APPROVER_UNKNOWN_AUTHOR: "forms.error.approverUnknownAuthor",
  PROPOSER_CANNOT_CONFIRM: "ops.error.proposerCannotConfirm",
  ENDPOINT_CHANGE_PENDING: "ops.error.endpointChangePending",
  ENDPOINT_PROPOSAL_NOT_FOUND: "ops.error.endpointProposalNotFound",
  ENDPOINT_PROPOSAL_NOT_PENDING: "ops.error.endpointProposalNotPending",
  unauthorized: "forms.error.unauthorized",
  rate_limited: "forms.error.rateLimited",
  internal: "forms.error.internal",
};

// Mirror the closed SSRF reason vocabulary across deployables; unknown reasons fall back to the general refusal.
export type WebhookUrlRejection =
  "not-a-url" | "unsupported-scheme" | "https-required" | "private-host";

// Never render the envelope message; only catalog-selected UI copy may cross this error boundary.
const WEBHOOK_REJECTION_MESSAGES: Readonly<Record<WebhookUrlRejection, MessageKey>> = {
  "not-a-url": "ops.error.webhookUrlNotAbsolute",
  "unsupported-scheme": "ops.error.webhookUrlScheme",
  "https-required": "ops.error.webhookUrlHttpsRequired",
  "private-host": "ops.error.webhookUrlPrivateHost",
};

function isWebhookUrlRejection(value: string): value is WebhookUrlRejection {
  return Object.hasOwn(WEBHOOK_REJECTION_MESSAGES, value);
}

// Name the refused question so a multi-question proposal does not leave the operator guessing.
export interface FormErrorContext {
  readonly question?: string | undefined;
  readonly reason?: string | undefined;
  readonly rejection?: string | undefined;
}

export function messageForFormCode(code: string, context?: FormErrorContext): string {
  const key = messageKeyFor(code, context?.rejection);
  if (key === undefined) return t("forms.error.unknown", { code });
  return t(key, {
    question: context?.question ?? code,
    reason: context?.reason ?? t("forms.error.internal"),
  });
}

// Unknown or missing reason values use the general sentence, never untrusted response prose.
function messageKeyFor(code: string, rejection: string | undefined): MessageKey | undefined {
  if (
    code === "WEBHOOK_URL_REJECTED" &&
    rejection !== undefined &&
    isWebhookUrlRejection(rejection)
  ) {
    return WEBHOOK_REJECTION_MESSAGES[rejection];
  }
  return FORM_CODE_MESSAGES[code];
}
