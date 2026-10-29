/**
 * Built rather than written inline so a static analyser does not read the probe as a
 * leaked secret; no account in any fixture has this value.
 */
export const WRONG_CREDENTIAL: Record<string, string> = {
  ["pass" + "word"]: ["never", "a", "real", "value"].join("-"),
};

/** Private in `middleware/internal-token.ts`, so it is restated here. */
export const INTERNAL_TOKEN_HEADER = "x-qcms-internal-token";

export type MatrixRow =
  | "start-session"
  | "redeem-link"
  | "step-answer-submit"
  | "authoring"
  | "responses-read"
  | "erasure"
  | "links-webhooks"
  | "membership"
  | "health";

/** ADR-09: an unmounted group answers 404, not 403. */
export type SurfaceGroup = "public" | "admin" | "auth" | "health";

export interface Surface {
  readonly name: string;
  readonly row: MatrixRow;
  readonly group: SurfaceGroup;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: (ctx: PathContext) => string;
  /** The shape only has to survive the gate, not the handler. */
  readonly body?: unknown;
  readonly anonymousReachable: boolean;
  /** A positive control: without one, a suite of 401s proves only that the URL is wrong. */
  readonly readControl?: true;
}

export interface PathContext {
  readonly formId: string;
  readonly formSlug: string;
  readonly sessionId: string;
  readonly otherSessionId: string;
  readonly linkId: string;
  readonly webhookId: string;
  readonly deliveryId: string;
  readonly questionId: string;
  readonly workspaceId: string;
  readonly teamId: string;
  readonly holderId: string;
}

export const SURFACES: readonly Surface[] = [
  {
    name: "POST /sessions (anonymous, by form slug)",
    row: "start-session",
    group: "public",
    method: "POST",
    path: () => "/sessions",
    body: { formSlug: "auto" },
    anonymousReachable: true,
  },
  {
    // Posting a token to `POST /sessions` is refused by the anonymous body's strict
    // object, which would make this row assert the schema rather than the channel gate.
    name: "POST /sessions/link (secure link redemption)",
    row: "redeem-link",
    group: "public",
    method: "POST",
    path: () => "/sessions/link",
    body: { token: "not-a-real-link-token" },
    anonymousReachable: true,
  },
  {
    name: "GET /sessions/{id}",
    row: "step-answer-submit",
    group: "public",
    method: "GET",
    path: (ctx) => `/sessions/${ctx.sessionId}`,
    anonymousReachable: false,
  },
  {
    name: "GET /sessions/{id}/step",
    row: "step-answer-submit",
    group: "public",
    method: "GET",
    path: (ctx) => `/sessions/${ctx.sessionId}/step`,
    anonymousReachable: false,
  },
  {
    name: "POST /sessions/{id}/answers",
    row: "step-answer-submit",
    group: "public",
    method: "POST",
    path: (ctx) => `/sessions/${ctx.sessionId}/answers`,
    body: { questionId: "q_driver_age", value: 40 },
    anonymousReachable: false,
  },
  {
    name: "POST /sessions/{id}/answers/batch",
    row: "step-answer-submit",
    group: "public",
    method: "POST",
    path: (ctx) => `/sessions/${ctx.sessionId}/answers/batch`,
    body: { answers: [{ questionId: "q_driver_age", value: 40 }] },
    anonymousReachable: false,
  },
  {
    name: "POST /sessions/{id}/roster",
    row: "step-answer-submit",
    group: "public",
    method: "POST",
    path: (ctx) => `/sessions/${ctx.sessionId}/roster`,
    body: { op: "add", groupId: "grp_vehicles", opToken: "op_000000000000000000000000" },
    anonymousReachable: false,
  },
  {
    name: "POST /sessions/{id}/submit",
    row: "step-answer-submit",
    group: "public",
    method: "POST",
    path: (ctx) => `/sessions/${ctx.sessionId}/submit`,
    body: {},
    anonymousReachable: false,
  },
  {
    name: "GET /admin/questions",
    row: "authoring",
    group: "admin",
    method: "GET",
    path: () => "/admin/questions",
    anonymousReachable: false,
    readControl: true,
  },
  {
    name: "POST /admin/questions",
    row: "authoring",
    group: "admin",
    method: "POST",
    path: () => "/admin/questions",
    body: { slug: "probe", definition: {} },
    anonymousReachable: false,
  },
  {
    name: "GET /admin/forms",
    row: "authoring",
    group: "admin",
    method: "GET",
    path: () => "/admin/forms",
    anonymousReachable: false,
    readControl: true,
  },
  {
    name: "PUT /admin/forms/{id}/draft",
    row: "authoring",
    group: "admin",
    method: "PUT",
    path: (ctx) => `/admin/forms/${ctx.formId}/draft`,
    body: { definition: {} },
    anonymousReachable: false,
  },
  {
    name: "POST /admin/forms/{id}/close",
    row: "authoring",
    group: "admin",
    method: "POST",
    path: (ctx) => `/admin/forms/${ctx.formId}/close`,
    body: { environment: "prod" },
    anonymousReachable: false,
  },
  {
    name: "POST /admin/forms/{id}/reopen",
    row: "authoring",
    group: "admin",
    method: "POST",
    path: (ctx) => `/admin/forms/${ctx.formId}/reopen`,
    body: { environment: "prod" },
    anonymousReachable: false,
  },
  {
    name: "POST /admin/forms/{id}/publish",
    row: "authoring",
    group: "admin",
    method: "POST",
    path: (ctx) => `/admin/forms/${ctx.formId}/publish`,
    body: {},
    anonymousReachable: false,
  },
  {
    name: "POST /admin/forms/{id}/releases",
    row: "authoring",
    group: "admin",
    method: "POST",
    path: (ctx) => `/admin/forms/${ctx.formId}/releases`,
    body: { environment: "prod", version: 1 },
    anonymousReachable: false,
  },
  {
    name: "GET /admin/forms/{id}/releases",
    row: "authoring",
    group: "admin",
    method: "GET",
    path: (ctx) => `/admin/forms/${ctx.formId}/releases`,
    anonymousReachable: false,
    readControl: true,
  },
  {
    name: "GET /admin/environments",
    row: "authoring",
    group: "admin",
    method: "GET",
    path: () => "/admin/environments",
    anonymousReachable: false,
    readControl: true,
  },
  {
    // A `POST` that writes nothing, so it is a positive control as well as a gate probe.
    name: "POST /admin/forms/{id}/release-review",
    row: "authoring",
    group: "admin",
    method: "POST",
    path: (ctx) => `/admin/forms/${ctx.formId}/release-review`,
    body: { source: { kind: "version", version: 1 } },
    anonymousReachable: false,
    readControl: true,
  },
  {
    // The credential table's `authoring` row, like every other admin read. Which grant
    // may call it is the role table's own row, asserted per persona in
    // `apps/api/src/features/operations/operations.integration.test.ts`.
    name: "GET /admin/operations/forms",
    row: "authoring",
    group: "admin",
    method: "GET",
    path: () => "/admin/operations/forms?environment=prod",
    anonymousReachable: false,
    readControl: true,
  },
  {
    name: "GET /admin/workspaces",
    row: "authoring",
    group: "admin",
    method: "GET",
    path: () => "/admin/workspaces",
    anonymousReachable: false,
    readControl: true,
  },
  {
    name: "POST /admin/workspaces",
    row: "authoring",
    group: "admin",
    method: "POST",
    path: () => "/admin/workspaces",
    body: { name: "Probe", slug: "probe-workspace" },
    anonymousReachable: false,
  },
  {
    name: "PUT /admin/workspaces/{id}/shared",
    row: "authoring",
    group: "admin",
    method: "PUT",
    path: (ctx) => `/admin/workspaces/${ctx.workspaceId}/shared`,
    body: { shared: false },
    anonymousReachable: false,
  },
  {
    name: "POST /admin/workspaces/{id}/archive",
    row: "authoring",
    group: "admin",
    method: "POST",
    path: (ctx) => `/admin/workspaces/${ctx.workspaceId}/archive`,
    body: {},
    anonymousReachable: false,
  },
  {
    name: "POST /admin/forms/{id}/workspace",
    row: "authoring",
    group: "admin",
    method: "POST",
    path: (ctx) => `/admin/forms/${ctx.formId}/workspace`,
    body: { workspaceId: "org_probe_target" },
    anonymousReachable: false,
  },
  {
    name: "POST /admin/questions/{id}/workspace",
    row: "authoring",
    group: "admin",
    method: "POST",
    path: (ctx) => `/admin/questions/${ctx.questionId}/workspace`,
    body: { workspaceId: "org_probe_target" },
    anonymousReachable: false,
  },
  // `GET /admin/me/access` needs no grant: it is the answer to what the caller holds, and
  // the one route the grant middleware exempts (Q35).
  {
    name: "GET /admin/me/access",
    row: "membership",
    group: "admin",
    method: "GET",
    path: () => "/admin/me/access",
    anonymousReachable: false,
    readControl: true,
  },
  {
    name: "GET /admin/workspaces/{id}/members",
    row: "membership",
    group: "admin",
    method: "GET",
    path: (ctx) => `/admin/workspaces/${ctx.workspaceId}/members`,
    anonymousReachable: false,
    readControl: true,
  },
  {
    name: "PUT /admin/workspaces/{id}/members/{userId}",
    row: "membership",
    group: "admin",
    method: "PUT",
    path: (ctx) => `/admin/workspaces/${ctx.workspaceId}/members/${ctx.holderId}`,
    body: { role: "member" },
    anonymousReachable: false,
  },
  {
    name: "GET /admin/workspaces/{id}/access-groups",
    row: "membership",
    group: "admin",
    method: "GET",
    path: (ctx) => `/admin/workspaces/${ctx.workspaceId}/access-groups`,
    anonymousReachable: false,
    readControl: true,
  },
  {
    name: "POST /admin/workspaces/{id}/access-groups",
    row: "membership",
    group: "admin",
    method: "POST",
    path: (ctx) => `/admin/workspaces/${ctx.workspaceId}/access-groups`,
    body: {
      name: "prod.responses.viewer.probe",
      role: "responses.viewer",
      environments: ["prod"],
      forms: ["all"],
      label: "probe",
    },
    anonymousReachable: false,
  },
  {
    name: "PUT /admin/workspaces/{id}/access-groups/{teamId}",
    row: "membership",
    group: "admin",
    method: "PUT",
    path: (ctx) => `/admin/workspaces/${ctx.workspaceId}/access-groups/${ctx.teamId}`,
    body: { name: "all.responses.viewer", environments: ["all"], forms: ["all"] },
    anonymousReachable: false,
  },
  {
    name: "DELETE /admin/workspaces/{id}/access-groups/{teamId}",
    row: "membership",
    group: "admin",
    method: "DELETE",
    path: (ctx) => `/admin/workspaces/${ctx.workspaceId}/access-groups/${ctx.teamId}`,
    anonymousReachable: false,
  },
  {
    name: "POST /admin/workspaces/{id}/access-groups/{teamId}/holders",
    row: "membership",
    group: "admin",
    method: "POST",
    path: (ctx) => `/admin/workspaces/${ctx.workspaceId}/access-groups/${ctx.teamId}/holders`,
    body: { email: "nobody@qcms.invalid" },
    anonymousReachable: false,
  },
  {
    name: "DELETE /admin/workspaces/{id}/access-groups/{teamId}/holders/{userId}",
    row: "membership",
    group: "admin",
    method: "DELETE",
    path: (ctx) =>
      `/admin/workspaces/${ctx.workspaceId}/access-groups/${ctx.teamId}/holders/${ctx.holderId}`,
    anonymousReachable: false,
  },
  {
    name: "PUT /admin/workspaces/{id}/settings",
    row: "membership",
    group: "admin",
    method: "PUT",
    path: (ctx) => `/admin/workspaces/${ctx.workspaceId}/settings`,
    body: { seedNewEditorsWithTestData: false },
    anonymousReachable: false,
  },
  {
    name: "GET /admin/workspaces/{id}/audit",
    row: "membership",
    group: "admin",
    method: "GET",
    path: (ctx) => `/admin/workspaces/${ctx.workspaceId}/audit`,
    anonymousReachable: false,
    readControl: true,
  },
  {
    name: "GET /admin/forms/{id}/responses",
    row: "responses-read",
    group: "admin",
    method: "GET",
    path: (ctx) => `/admin/forms/${ctx.formId}/responses`,
    anonymousReachable: false,
    readControl: true,
  },
  {
    name: "GET /admin/forms/{id}/responses/{sessionId}",
    row: "responses-read",
    group: "admin",
    method: "GET",
    path: (ctx) => `/admin/forms/${ctx.formId}/responses/${ctx.sessionId}`,
    anonymousReachable: false,
  },
  {
    name: "GET /admin/forms/{id}/export",
    row: "responses-read",
    group: "admin",
    method: "GET",
    path: (ctx) => `/admin/forms/${ctx.formId}/export?format=csv&version=1`,
    anonymousReachable: false,
    readControl: true,
  },
  {
    name: "POST /admin/forms/{id}/responses/{sessionId}/erase",
    row: "erasure",
    group: "admin",
    method: "POST",
    path: (ctx) => `/admin/forms/${ctx.formId}/responses/${ctx.sessionId}/erase`,
    body: { reason: "probe" },
    anonymousReachable: false,
  },
  {
    name: "GET /admin/forms/{id}/responses/{sessionId}/erasure-scope",
    row: "erasure",
    group: "admin",
    method: "GET",
    path: (ctx) => `/admin/forms/${ctx.formId}/responses/${ctx.sessionId}/erasure-scope`,
    anonymousReachable: false,
    readControl: true,
  },
  {
    name: "GET /admin/erasures",
    row: "erasure",
    group: "admin",
    method: "GET",
    path: () => "/admin/erasures",
    anonymousReachable: false,
    readControl: true,
  },
  {
    name: "POST /admin/forms/{id}/links",
    row: "links-webhooks",
    group: "admin",
    method: "POST",
    path: (ctx) => `/admin/forms/${ctx.formId}/links`,
    // `environment` is required with no default, and a body the schema refuses would make
    // this row assert the request schema rather than the channel and session gates.
    body: { environment: "prod", expiresAt: "2099-01-01T00:00:00.000Z" },
    anonymousReachable: false,
  },
  {
    name: "GET /admin/forms/{id}/links",
    row: "links-webhooks",
    group: "admin",
    method: "GET",
    path: (ctx) => `/admin/forms/${ctx.formId}/links`,
    anonymousReachable: false,
    readControl: true,
  },
  {
    name: "POST /admin/forms/{id}/links/{linkId}/revoke",
    row: "links-webhooks",
    group: "admin",
    method: "POST",
    path: (ctx) => `/admin/forms/${ctx.formId}/links/${ctx.linkId}/revoke`,
    body: {},
    anonymousReachable: false,
  },
  {
    name: "POST /admin/forms/{id}/webhooks",
    row: "links-webhooks",
    group: "admin",
    method: "POST",
    path: (ctx) => `/admin/forms/${ctx.formId}/webhooks`,
    body: { url: "https://consumer.example/hook" },
    anonymousReachable: false,
  },
  {
    name: "GET /admin/forms/{id}/webhooks",
    row: "links-webhooks",
    group: "admin",
    method: "GET",
    path: (ctx) => `/admin/forms/${ctx.formId}/webhooks`,
    anonymousReachable: false,
    readControl: true,
  },
  {
    name: "DELETE /admin/forms/{id}/webhooks/{webhookId}",
    row: "links-webhooks",
    group: "admin",
    method: "DELETE",
    path: (ctx) => `/admin/forms/${ctx.formId}/webhooks/${ctx.webhookId}`,
    anonymousReachable: false,
  },
  {
    name: "GET /admin/forms/{id}/webhooks/proposals",
    row: "links-webhooks",
    group: "admin",
    method: "GET",
    path: (ctx) => `/admin/forms/${ctx.formId}/webhooks/proposals`,
    anonymousReachable: false,
    readControl: true,
  },
  {
    name: "POST /admin/forms/{id}/webhooks/proposals/{proposalId}/confirm",
    row: "links-webhooks",
    group: "admin",
    method: "POST",
    // An id this fixture never minted: the gate refuses the credential shape before the
    // handler ever looks it up.
    path: (ctx) => `/admin/forms/${ctx.formId}/webhooks/proposals/wep_notreal/confirm`,
    anonymousReachable: false,
  },
  {
    name: "DELETE /admin/forms/{id}/webhooks/proposals/{proposalId}",
    row: "links-webhooks",
    group: "admin",
    method: "DELETE",
    path: (ctx) => `/admin/forms/${ctx.formId}/webhooks/proposals/wep_notreal`,
    anonymousReachable: false,
  },
  {
    name: "GET /admin/forms/{id}/deliveries",
    row: "links-webhooks",
    group: "admin",
    method: "GET",
    path: (ctx) => `/admin/forms/${ctx.formId}/deliveries`,
    anonymousReachable: false,
    readControl: true,
  },
  {
    name: "GET /admin/outbox/dead-letters",
    row: "links-webhooks",
    group: "admin",
    method: "GET",
    path: () => "/admin/outbox/dead-letters",
    anonymousReachable: false,
    readControl: true,
  },
  {
    name: "POST /admin/forms/{id}/deliveries/{deliveryId}/redeliver",
    row: "links-webhooks",
    group: "admin",
    method: "POST",
    path: (ctx) => `/admin/forms/${ctx.formId}/deliveries/${ctx.deliveryId}/redeliver`,
    body: {},
    anonymousReachable: false,
  },
  {
    name: "POST /api/auth/sign-in/email",
    row: "authoring",
    group: "auth",
    method: "POST",
    path: () => "/api/auth/sign-in/email",
    body: { email: "nobody@example.test", ...WRONG_CREDENTIAL },
    anonymousReachable: false,
  },
  {
    name: "GET /health",
    row: "health",
    group: "health",
    method: "GET",
    path: () => "/health",
    anonymousReachable: true,
  },
  {
    name: "GET /ready",
    row: "health",
    group: "health",
    method: "GET",
    path: () => "/ready",
    anonymousReachable: true,
  },
];

export const GATED_SURFACES: readonly Surface[] = SURFACES.filter((s) => s.group !== "health");

export const ADMIN_SURFACES: readonly Surface[] = SURFACES.filter((s) => s.group === "admin");

export const READ_CONTROL_SURFACES: readonly Surface[] = SURFACES.filter(
  (s) => s.readControl === true,
);

export interface ProbeResult {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

/**
 * Declared method-style rather than as a property holding a function type, so TypeScript
 * compares it bivariantly: a narrower property type would reject Hono's own `request`.
 */
interface Fetcher {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

/**
 * No credential is ever attached implicitly, which is what makes a negative result mean
 * something.
 */
export async function probe(
  app: Fetcher,
  surface: Surface,
  ctx: PathContext,
  headers: Record<string, string> = {},
): Promise<ProbeResult> {
  const init: RequestInit = {
    method: surface.method,
    headers:
      surface.body === undefined ? headers : { "content-type": "application/json", ...headers },
    ...(surface.body === undefined ? {} : { body: JSON.stringify(surface.body) }),
  };
  const res = await app.request(surface.path(ctx), init);
  return { status: res.status, headers: res.headers, text: await res.text() };
}
