/**
 * Thin HTTP clients for the e2e suite (task 027).
 *
 * Scenarios drive the product only through these — `app.request(...)` under the
 * hood, one method per product action, so a scenario reads as a story ("admin
 * publishes the form; respondent walks the branch; admin exports") rather than a
 * pile of fetch plumbing. They are the *consumer's* view: HTTP verbs, headers,
 * and JSON bodies, no imports from any slice's handler.
 *
 * Every request carries the internal service token (SEC-4). Admin calls add the
 * admin-session marker (021 stub); respondent session-scoped calls add the
 * `Bearer` session token minted by `POST /sessions`.
 */

import { ADMIN_SESSION_HEADER } from "../../src/middleware/admin-auth.js";
import type { createApp } from "../../src/app.js";

/** The internal-token header (SEC-4); the wire name is stable (031 keeps it). */
const INTERNAL_TOKEN_HEADER = "x-qcms-internal-token";

type App = ReturnType<typeof createApp>;

/** The parsed outcome of a JSON request. */
export interface JsonResult<T = unknown> {
  readonly status: number;
  readonly body: T;
}

/** The outcome of a raw (non-JSON) request — used for exports. */
export interface RawResult {
  readonly status: number;
  readonly contentType: string | null;
  readonly contentDisposition: string | null;
  readonly text: string;
}

async function parse<T>(res: Response): Promise<JsonResult<T>> {
  const text = await res.text();
  return { status: res.status, body: (text === "" ? undefined : JSON.parse(text)) as T };
}

/**
 * The admin authoring surface (`/admin/*`). One instance per composition; the
 * session marker is any non-empty string under the launch stub (021).
 */
export class AdminClient {
  constructor(
    private readonly app: App,
    private readonly internalToken: string,
    private readonly sessionMarker = "e2e-admin",
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "content-type": "application/json",
      [INTERNAL_TOKEN_HEADER]: this.internalToken,
      [ADMIN_SESSION_HEADER]: this.sessionMarker,
      ...extra,
    };
  }

  private async req(method: string, path: string, body?: unknown): Promise<Response> {
    return this.app.request(`/admin${path}`, {
      method,
      headers: this.headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  // --- questions ------------------------------------------------------------

  async createQuestion<T = unknown>(input: {
    slug: string;
    definition: unknown;
  }): Promise<JsonResult<T>> {
    return parse<T>(await this.req("POST", "/questions", input));
  }

  async addQuestionVersion<T = unknown>(questionId: string): Promise<JsonResult<T>> {
    return parse<T>(await this.req("POST", `/questions/${questionId}/versions`));
  }

  async publishQuestionVersion<T = unknown>(
    questionId: string,
    version: number,
  ): Promise<JsonResult<T>> {
    return parse<T>(await this.req("POST", `/questions/${questionId}/versions/${version}/publish`));
  }

  // --- forms ----------------------------------------------------------------

  async createForm<T = unknown>(input: {
    formId: string;
    slug: string;
    defaultLocale: string;
  }): Promise<JsonResult<T>> {
    return parse<T>(await this.req("POST", "/forms", input));
  }

  async saveDraft<T = unknown>(formId: string, definition: unknown): Promise<JsonResult<T>> {
    return parse<T>(await this.req("PUT", `/forms/${formId}/draft`, { definition }));
  }

  async publishForm<T = unknown>(formId: string): Promise<JsonResult<T>> {
    return parse<T>(await this.req("POST", `/forms/${formId}/publish`));
  }

  // --- secure links ---------------------------------------------------------

  async mintLinks<T = unknown>(
    formId: string,
    input: { expiresAt: string; oneTime?: boolean; count?: number },
  ): Promise<JsonResult<T>> {
    return parse<T>(await this.req("POST", `/forms/${formId}/links`, input));
  }

  // --- webhooks -------------------------------------------------------------

  async createWebhook<T = unknown>(
    formId: string,
    input: { url: string; secret?: string; active?: boolean },
  ): Promise<JsonResult<T>> {
    return parse<T>(await this.req("POST", `/forms/${formId}/webhooks`, input));
  }

  // --- responses: read / export / erase ------------------------------------

  async listResponses<T = unknown>(
    formId: string,
    query: Record<string, string> = {},
  ): Promise<JsonResult<T>> {
    const qs = new URLSearchParams(query).toString();
    return parse<T>(await this.req("GET", `/forms/${formId}/responses${qs ? `?${qs}` : ""}`));
  }

  async export(formId: string, query: Record<string, string>): Promise<RawResult> {
    const qs = new URLSearchParams(query).toString();
    const res = await this.req("GET", `/forms/${formId}/export${qs ? `?${qs}` : ""}`);
    return {
      status: res.status,
      contentType: res.headers.get("content-type"),
      contentDisposition: res.headers.get("content-disposition"),
      text: await res.text(),
    };
  }

  async eraseSession<T = unknown>(sessionId: string, reason: string): Promise<JsonResult<T>> {
    return parse<T>(await this.req("POST", `/sessions/${sessionId}/erase`, { reason }));
  }

  async listTombstones<T = unknown>(query: Record<string, string> = {}): Promise<JsonResult<T>> {
    const qs = new URLSearchParams(query).toString();
    return parse<T>(await this.req("GET", `/erasures${qs ? `?${qs}` : ""}`));
  }
}

/**
 * The public respondent surface (session lifecycle). No admin marker; the
 * session-scoped calls carry the `Bearer` session token.
 */
export class RespondentClient {
  constructor(
    private readonly app: App,
    private readonly internalToken: string,
  ) {}

  private headers(token?: string): Record<string, string> {
    return {
      "content-type": "application/json",
      [INTERNAL_TOKEN_HEADER]: this.internalToken,
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    };
  }

  /** Start a session either anonymously (`{ formSlug }`) or via a link (`{ token }`). */
  async start<T = unknown>(body: { formSlug: string } | { token: string }): Promise<JsonResult<T>> {
    return parse<T>(
      await this.app.request("/sessions", {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      }),
    );
  }

  async getStep<T = unknown>(sessionId: string, sessionToken?: string): Promise<JsonResult<T>> {
    return parse<T>(
      await this.app.request(`/sessions/${sessionId}/step`, {
        headers: this.headers(sessionToken),
      }),
    );
  }

  async answer<T = unknown>(
    sessionId: string,
    sessionToken: string,
    questionId: string,
    value: unknown,
  ): Promise<JsonResult<T>> {
    return parse<T>(
      await this.app.request(`/sessions/${sessionId}/answers`, {
        method: "POST",
        headers: this.headers(sessionToken),
        body: JSON.stringify({ questionId, value }),
      }),
    );
  }

  async submit<T = unknown>(
    sessionId: string,
    sessionToken: string,
    body: Record<string, unknown> = {},
  ): Promise<JsonResult<T>> {
    return parse<T>(
      await this.app.request(`/sessions/${sessionId}/submit`, {
        method: "POST",
        headers: this.headers(sessionToken),
        body: JSON.stringify(body),
      }),
    );
  }
}

/** Extract the opaque link token from a minted link URL (`…/l/<token>`). */
export function tokenFromLinkUrl(url: string): string {
  const marker = "/l/";
  const idx = url.lastIndexOf(marker);
  if (idx < 0) throw new Error(`unexpected link url shape: ${url}`);
  return url.slice(idx + marker.length);
}
