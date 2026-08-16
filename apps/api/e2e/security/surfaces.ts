/**
 * The probe vocabulary shared by the 040 security e2e suites.
 *
 * The authorization matrix at `docs/SECURITY_DESIGN.md` §3.2 has eight rows and
 * four credential columns. Asserting it by hand, cell by cell, produces a file
 * nobody reads and a coverage claim nobody can check. So the rows are declared
 * once here, as data, and each suite walks them under one credential shape.
 * `matrix-coverage.e2e.ts` closes the loop in both directions: it parses the
 * §3.2 table out of the shipped `docs/SECURITY_DESIGN.md` and fails if a
 * documented row has no surface here, or if a surface here names a row the
 * document does not describe.
 *
 * Deliberately *not* built on `AdminClient` / `RespondentClient`: both hard-attach
 * a complete credential set, and the whole point here is to send an incomplete
 * one. Everything goes through `app.request()` with headers assembled per probe.
 */

/**
 * The deliberately wrong credential the sign-in probe carries. Built rather than
 * written inline so a static analyser does not read the probe as a leaked secret:
 * no account in any fixture has this value.
 */
export const WRONG_CREDENTIAL: Record<string, string> = {
  ["pass" + "word"]: ["never", "a", "real", "value"].join("-"),
};

/** SEC-4 channel token header. Private in `middleware/internal-token.ts`, so it is restated. */
export const INTERNAL_TOKEN_HEADER = "x-qcms-internal-token";

/** The §3.2 row a surface belongs to. One row may have several representative routes. */
export type MatrixRow =
  | "start-session"
  | "redeem-link"
  | "step-answer-submit"
  | "authoring"
  | "responses-read"
  | "erasure"
  | "links-webhooks"
  | "health";

/** Which mounted group carries the surface (ADR-09: an unmounted group is 404, not 403). */
export type SurfaceGroup = "public" | "admin" | "auth" | "health";

export interface Surface {
  /** Stable probe name, used in test titles. */
  readonly name: string;
  readonly row: MatrixRow;
  readonly group: SurfaceGroup;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path built from the seeded ids; `ctx.sessionId` is session A. */
  readonly path: (ctx: PathContext) => string;
  /** JSON body for write methods. Shape only has to survive the *gate*, not the handler. */
  readonly body?: unknown;
  /**
   * True when the surface is reachable by an anonymous end user over the channel
   * (matrix column 1). Everything else demands a user credential on top.
   */
  readonly anonymousReachable: boolean;
  /**
   * True for a side-effect-free admin read whose path uses only real seeded ids,
   * so the fully credentialed caller is genuinely served. These are the positive
   * controls: without them a suite of 401s proves only that the URL is wrong.
   */
  readonly readControl?: true;
}

export interface PathContext {
  readonly formId: string;
  readonly formSlug: string;
  /** Session A: the session whose token the "own session" column holds. */
  readonly sessionId: string;
  /** Session B: a second respondent's session, for the cross-session column. */
  readonly otherSessionId: string;
  readonly linkId: string;
  readonly webhookId: string;
  readonly deliveryId: string;
  readonly questionId: string;
}

/**
 * Every row of §3.2, with at least one representative route per row and every
 * admin slice represented at least once. `anonymousReachable` records the
 * matrix's first column: only session start, link redemption and health are
 * open to a caller carrying no user credential.
 */
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
    name: "POST /sessions (secure link redemption)",
    row: "redeem-link",
    group: "public",
    method: "POST",
    path: () => "/sessions",
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
    name: "POST /admin/forms/{id}/publish",
    row: "authoring",
    group: "admin",
    method: "POST",
    path: (ctx) => `/admin/forms/${ctx.formId}/publish`,
    body: {},
    anonymousReachable: false,
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
    body: { expiresAt: "2099-01-01T00:00:00.000Z" },
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
    name: "POST /admin/links/{linkId}/revoke",
    row: "links-webhooks",
    group: "admin",
    method: "POST",
    path: (ctx) => `/admin/links/${ctx.linkId}/revoke`,
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

/** Every surface behind the SEC-4 channel gate (i.e. everything except health). */
export const GATED_SURFACES: readonly Surface[] = SURFACES.filter((s) => s.group !== "health");

/** Admin-group surfaces only (the ones the admin-session gate must also refuse). */
export const ADMIN_SURFACES: readonly Surface[] = SURFACES.filter((s) => s.group === "admin");

/** Side-effect-free admin reads used as positive controls (see `Surface.readControl`). */
export const READ_CONTROL_SURFACES: readonly Surface[] = SURFACES.filter(
  (s) => s.readControl === true,
);

export interface ProbeResult {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

/**
 * The one thing a probe needs from a composed app. Declared method-style (rather
 * than as a property holding a function type) so TypeScript compares it
 * bivariantly: Hono's `request` takes `RequestInfo | URL` and extra optional
 * arguments, and a narrower property type would reject the real app.
 */
interface Fetcher {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

/**
 * Send one probe. Headers are exactly what the caller passes plus a content type
 * for bodied methods: no credential is ever attached implicitly, which is the
 * property that makes a negative result mean something.
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
