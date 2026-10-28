/**
 * Assertion half of `scripts/scaffold-e2e.mjs`. Speaks plain HTTP and imports nothing from
 * this workspace, so a shared helper cannot be right about a shape the shipped image gets wrong.
 */

import { beforeAll, describe, expect, it } from "vitest";

/** Read a variable the orchestrator sets, failing loudly rather than defaulting. */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is unset. Run this project through \`pnpm qcms:scaffold-e2e\`, which starts the stack it drives.`,
    );
  }
  return value;
}

const API = required("QCMS_SCAFFOLD_API_URL");
const PORTAL = required("QCMS_SCAFFOLD_PORTAL_URL");
const ADMIN = required("QCMS_SCAFFOLD_ADMIN_URL");
/** The origin the scaffolder was told about; differs from `PORTAL` inside the dev container. */
const PORTAL_BASE_URL = required("QCMS_SCAFFOLD_PORTAL_BASE_URL");
/** The admin origin better-auth was configured to trust. Its `Origin` check compares by equality. */
const ADMIN_BASE_URL = required("QCMS_SCAFFOLD_ADMIN_BASE_URL");
const INTERNAL_TOKEN = required("QCMS_SCAFFOLD_INTERNAL_TOKEN");
const ADMIN_EMAIL = required("QCMS_SCAFFOLD_ADMIN_EMAIL");
const ADMIN_PASSWORD = required("QCMS_SCAFFOLD_ADMIN_PASSWORD");
/** Generated per run: a literal is a hard-coded credential the lint gate flags. */
const CHOSEN_PASSWORD = `scaffold-chosen-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;

/** One run's identifiers, so a repeat run against a kept stack does not collide. */
const RUN = Date.now()
  .toString(36)
  .replace(/[^a-z0-9]/g, "");
const QUESTION_ID = `q_scaffold_${RUN}`;
const FORM_ID = `frm_scaffold_${RUN}`;

let adminSession = "";

/** Every API call carries the SEC-4 service token; admin calls add the session. */
function headers(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  return { "x-qcms-internal-token": INTERNAL_TOKEN, "content-type": "application/json", ...extra };
}

function adminHeaders(): Record<string, string> {
  return headers({ "x-qcms-admin-session": adminSession });
}

/**
 * SEC-9's CSRF belt refuses a POST without `Sec-Fetch-Site: same-origin` or an `Origin`
 * equal to `QCMS_PORTAL_BASE_URL`. Sending the configured value, not the dialled address,
 * fails if the scaffolder wrote the wrong one to `.env`.
 */
function portalPostHeaders(sessionCookie: string): Record<string, string> {
  return {
    cookie: sessionCookie,
    "content-type": "application/json",
    origin: PORTAL_BASE_URL,
  };
}

/** Fetch and parse, failing with the body rather than with `undefined is not an object`. */
async function json(
  url: string,
  init: RequestInit,
  expectedStatus: readonly number[],
): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  const body = await response.text();
  if (!expectedStatus.includes(response.status)) {
    throw new Error(
      `${init.method ?? "GET"} ${url} returned ${String(response.status)}, expected one of ${expectedStatus.join(", ")}.\n${body}`,
    );
  }
  return body === "" ? {} : (JSON.parse(body) as Record<string, unknown>);
}

describe("a scaffolded QCMS deployment", () => {
  beforeAll(async () => {
    // `Origin` must be the admin origin (better-auth `trustedOrigins`); anything else is a 403.
    // The bare token is in the response body; the cookie value is `<token>.<signature>`.
    const signInResponse = await fetch(`${API}/api/auth/sign-in/email`, {
      method: "POST",
      headers: headers({ origin: ADMIN_BASE_URL }),
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    const signInBody = await signInResponse.text();
    if (signInResponse.status !== 200) {
      throw new Error(`sign-in returned ${String(signInResponse.status)}.\n${signInBody}`);
    }
    expect(typeof (JSON.parse(signInBody) as Record<string, unknown>)["token"]).toBe("string");

    // The bootstrap password is provisional: every admin route answers 401 until it is changed.
    // The auth mount reads the cookie, not `x-qcms-admin-session`; `getSetCookie()` keeps
    // signed values unfolded.
    const sessionCookie = signInResponse.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    expect(sessionCookie).not.toBe("");

    const changed = await json(
      `${API}/api/auth/change-password`,
      {
        method: "POST",
        headers: headers({ origin: ADMIN_BASE_URL, cookie: sessionCookie }),
        body: JSON.stringify({
          currentPassword: ADMIN_PASSWORD,
          newPassword: CHOSEN_PASSWORD,
          // SEC-1: a stolen session must not outlive the credential. The token below
          // comes from this response because the sign-in session is revoked.
          revokeOtherSessions: true,
        }),
      },
      [200],
    );
    expect(typeof changed["token"]).toBe("string");
    adminSession = String(changed["token"]);
  }, 60_000);

  it("forces the provisional bootstrap credential to be changed before any admin route", async () => {
    const stale = await fetch(`${API}/api/auth/sign-in/email`, {
      method: "POST",
      headers: headers({ origin: ADMIN_BASE_URL }),
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    expect(stale.status).not.toBe(200);

    const reachable = await fetch(`${API}/admin/questions`, { headers: adminHeaders() });
    expect(reachable.ok).toBe(true);
  });

  it("serves both applications", async () => {
    expect((await fetch(`${PORTAL}/`)).ok).toBe(true);
    expect((await fetch(`${ADMIN}/healthz`)).ok).toBe(true);
  });

  it("reports ready, which means the one-shot migration ran before the API started", async () => {
    const ready = await fetch(`${API}/ready`, { headers: headers() });
    expect(ready.ok).toBe(true);
  });

  it("refuses an admin call with no service token, so SEC-4 survived the scaffold", async () => {
    const response = await fetch(`${API}/admin/questions`, {
      headers: { "x-qcms-admin-session": adminSession },
    });
    expect(response.status).toBe(401);
  });

  it("refuses an admin call with no session, so the admin gate survived too", async () => {
    const response = await fetch(`${API}/admin/questions`, { headers: headers() });
    expect(response.status).toBe(401);
  });

  it("completes the scenario-1 loop: author, publish, release, link, respond, submit, read back", async () => {
    // 1. Author a question and publish version 1.
    await json(
      `${API}/admin/questions`,
      {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          slug: `scaffold-${RUN}`,
          definition: {
            type: "shortText",
            questionId: QUESTION_ID,
            label: { en: "Policy holder name" },
            required: true,
          },
        }),
      },
      [201, 200],
    );
    await json(
      `${API}/admin/questions/${QUESTION_ID}/versions/1/publish`,
      { method: "POST", headers: adminHeaders() },
      [200],
    );

    // 2. Author a one-step form and publish it.
    await json(
      `${API}/admin/forms`,
      {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ formId: FORM_ID, slug: `scaffold-${RUN}`, defaultLocale: "en" }),
      },
      [201, 200],
    );
    const draft = await json(
      `${API}/admin/forms/${FORM_ID}/draft`,
      {
        method: "PUT",
        headers: adminHeaders(),
        body: JSON.stringify({
          definition: {
            formId: FORM_ID,
            defaultLocale: "en",
            title: { en: "Scaffold smoke" },
            steps: [
              {
                stepId: "stp_only",
                title: { en: "Your details" },
                items: [{ questionId: QUESTION_ID, version: 1 }],
              },
            ],
            rules: [],
          },
        }),
      },
      [200],
    );
    expect(draft["issues"]).toStrictEqual([]);

    const published = await json(
      `${API}/admin/forms/${FORM_ID}/publish`,
      { method: "POST", headers: adminHeaders() },
      [200, 201],
    );
    expect(published["version"]).toBe(1);

    // 2b. Publishing serves nothing; a session resolves the version released to its
    //     environment (ADR-40). `prod` is the unprefixed one a scaffold serves.
    await json(
      `${API}/admin/forms/${FORM_ID}/releases`,
      {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ environment: "test", version: published["version"] }),
      },
      [200, 201],
    );
    const released = await json(
      `${API}/admin/forms/${FORM_ID}/releases`,
      {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          environment: "prod",
          version: published["version"],
          fromEnvironment: "test",
        }),
      },
      [200, 201],
    );
    expect(released["version"]).toBe(1);

    // 3. Mint a secure link; its URL is built from QCMS_PORTAL_BASE_URL.
    //    `environment` is required with no default (ADR-40, Q19).
    const minted = await json(
      `${API}/admin/forms/${FORM_ID}/links`,
      {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          environment: "prod",
          expiresAt: "2999-01-01T00:00:00.000Z",
          oneTime: false,
          count: 1,
        }),
      },
      [201, 200],
    );
    const links = minted["links"] as { url: string }[];
    expect(links).toHaveLength(1);
    const linkUrl = links[0]?.url ?? "";
    expect(linkUrl.startsWith(`${PORTAL_BASE_URL}/l/`)).toBe(true);

    // 4. Redeem it through the portal address this run dials, not the minted origin.
    const redeemed = await fetch(`${PORTAL}${new URL(linkUrl).pathname}`, { redirect: "manual" });
    expect(redeemed.status).toBe(303);
    const sessionCookie = (redeemed.headers.getSetCookie() ?? [])
      .map((cookie) => cookie.split(";")[0] ?? "")
      .join("; ");
    expect(sessionCookie).toContain("qcms_session=");
    // Next's absolute Location uses the container bind address; follow only the path.
    const sessionPath = new URL(redeemed.headers.get("location") ?? "", PORTAL).pathname;
    expect(sessionPath).toMatch(/^\/s\/ses_/);

    // 5. Answer and submit.
    const step = await json(
      `${PORTAL}${sessionPath}/step`,
      { headers: { cookie: sessionCookie } },
      [200],
    );
    expect(JSON.stringify(step)).toContain(QUESTION_ID);

    await json(
      `${PORTAL}${sessionPath}/answers`,
      {
        method: "POST",
        headers: portalPostHeaders(sessionCookie),
        body: JSON.stringify({ questionId: QUESTION_ID, value: "Alex Respondent" }),
      },
      [200],
    );
    const submitted = await json(
      `${PORTAL}${sessionPath}/submit`,
      {
        method: "POST",
        headers: portalPostHeaders(sessionCookie),
        body: JSON.stringify({}),
      },
      [200],
    );
    expect(submitted["ok"]).toBe(true);

    // 5a. `create-admin` seeds no `responses.*` grant (ADR-41, Q29), so grant one
    //     explicitly; a self-grant is allowed and audited by default (Q13, Q56).
    const workspaces = (await json(
      `${API}/admin/workspaces`,
      { headers: adminHeaders() },
      [200],
    )) as { workspaces?: { workspaceId?: string }[] };
    const workspaceId = workspaces.workspaces?.[0]?.workspaceId;
    expect(typeof workspaceId).toBe("string");

    const group = (await json(
      `${API}/admin/workspaces/${String(workspaceId)}/access-groups`,
      {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          // A name out of step with the group's fields is refused on save (Q37).
          name: "all.responses.viewer",
          role: "responses.viewer",
          environments: ["all"],
          forms: ["all"],
        }),
      },
      [201],
    )) as { group?: { teamId?: string } };
    const teamId = group.group?.teamId;
    expect(typeof teamId).toBe("string");

    await json(
      `${API}/admin/workspaces/${String(workspaceId)}/access-groups/${String(teamId)}/holders`,
      { method: "POST", headers: adminHeaders(), body: JSON.stringify({ email: ADMIN_EMAIL }) },
      [201],
    );

    // 6. Read it back through the admin API.
    const responses = await json(
      `${API}/admin/forms/${FORM_ID}/responses`,
      { headers: adminHeaders() },
      [200],
    );
    expect(JSON.stringify(responses)).toContain("ses_");

    const sessionId = sessionPath.slice("/s/".length);
    const detail = await json(
      `${API}/admin/forms/${FORM_ID}/responses/${sessionId}`,
      { headers: adminHeaders() },
      [200],
    );
    expect(JSON.stringify(detail)).toContain("Alex Respondent");
  }, 120_000);
});
