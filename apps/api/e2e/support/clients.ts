import { DEFAULT_TEST_ENVIRONMENT } from "@roonga/qcms-db/testing";

import { ADMIN_SESSION_HEADER } from "../../src/middleware/admin-auth.js";
import type { createApp } from "../../src/app.js";

const INTERNAL_TOKEN_HEADER = "x-qcms-internal-token";

type App = ReturnType<typeof createApp>;

export interface JsonResult<T = unknown> {
  readonly status: number;
  readonly body: T;
}

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
 * The session token is a real better-auth session token the middleware resolves against
 * the database, so there is deliberately no default: call `adminLogin()` first.
 */
export class AdminClient {
  constructor(
    private readonly app: App,
    private readonly internalToken: string,
    private readonly adminSessionToken: string,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "content-type": "application/json",
      [INTERNAL_TOKEN_HEADER]: this.internalToken,
      [ADMIN_SESSION_HEADER]: this.adminSessionToken,
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

  /**
   * Beside `publishForm` rather than folded into it: publishing puts a version in the
   * library and serves it nowhere, and this is what puts it in front of a respondent.
   */
  async releaseVersion<T = unknown>(
    formId: string,
    input: { environment: string; version: number; fromEnvironment?: string },
  ): Promise<JsonResult<T>> {
    return parse<T>(await this.req("POST", `/forms/${formId}/releases`, input));
  }

  /**
   * `environment` defaults to the one this harness serves, because the API requires the
   * field with no default of its own.
   */
  async mintLinks<T = unknown>(
    formId: string,
    input: { environment?: string; expiresAt: string; oneTime?: boolean; count?: number },
  ): Promise<JsonResult<T>> {
    return parse<T>(
      await this.req("POST", `/forms/${formId}/links`, {
        environment: DEFAULT_TEST_ENVIRONMENT,
        ...input,
      }),
    );
  }

  async createWebhook<T = unknown>(
    formId: string,
    input: { url: string; secret?: string; active?: boolean },
  ): Promise<JsonResult<T>> {
    return parse<T>(await this.req("POST", `/forms/${formId}/webhooks`, input));
  }

  async listResponses<T = unknown>(
    formId: string,
    query: Record<string, string> = {},
  ): Promise<JsonResult<T>> {
    const qs = new URLSearchParams(query).toString();
    const suffix = qs ? `?${qs}` : "";
    return parse<T>(await this.req("GET", `/forms/${formId}/responses${suffix}`));
  }

  async export(formId: string, query: Record<string, string>): Promise<RawResult> {
    const qs = new URLSearchParams(query).toString();
    const suffix = qs ? `?${qs}` : "";
    const res = await this.req("GET", `/forms/${formId}/export${suffix}`);
    return {
      status: res.status,
      contentType: res.headers.get("content-type"),
      contentDisposition: res.headers.get("content-disposition"),
      text: await res.text(),
    };
  }

  async eraseSession<T = unknown>(
    formId: string,
    sessionId: string,
    reason: string,
  ): Promise<JsonResult<T>> {
    return parse<T>(
      await this.req("POST", `/forms/${formId}/responses/${sessionId}/erase`, { reason }),
    );
  }

  async listTombstones<T = unknown>(query: Record<string, string> = {}): Promise<JsonResult<T>> {
    const qs = new URLSearchParams(query).toString();
    const suffix = qs ? `?${qs}` : "";
    return parse<T>(await this.req("GET", `/erasures${suffix}`));
  }
}

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

  /**
   * Two routes, because the entry modes ride different mount decisions: `POST /sessions`
   * is `prod`'s form-slug door and `POST /sessions/link` is on every environment's
   * surface.
   */
  async start<T = unknown>(body: { formSlug: string } | { token: string }): Promise<JsonResult<T>> {
    return parse<T>(
      await this.app.request("token" in body ? "/sessions/link" : "/sessions", {
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

export function tokenFromLinkUrl(url: string): string {
  const marker = "/l/";
  const idx = url.lastIndexOf(marker);
  if (idx < 0) throw new Error(`unexpected link url shape: ${url}`);
  return url.slice(idx + marker.length);
}
