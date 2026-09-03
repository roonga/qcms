/**
 * Scenario 1, against a stack built and started from a scaffolded project (task 037,
 * exit criteria 1 and 3).
 *
 * `scripts/scaffold-e2e.mjs` packs the tarballs, runs the CLI from its own tarball,
 * installs, builds the images and starts the stack; this file is the assertion half.
 * It is a separate Vitest project (`create-qcms-app-e2e`) exactly as the 027 API
 * suite is, so it never runs inside `pnpm test`, where there is no stack to drive.
 *
 * It speaks plain HTTP and imports nothing from this workspace. That is the point:
 * an adopter has no `@qcms/core` types at the wire, and a helper imported from here
 * could be right about a shape the shipped image is wrong about.
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
/**
 * The portal origin the SCAFFOLDER was told about, which is not always where this
 * suite dials: inside the dev container the harness reaches the stack over Compose's
 * own network. Kept separate on purpose, because the two answer different questions -
 * "can I reach it" and "did the operator's answer reach the API".
 */
const PORTAL_BASE_URL = required("QCMS_SCAFFOLD_PORTAL_BASE_URL");
/** The admin origin better-auth was configured to trust. Its `Origin` check compares by equality. */
const ADMIN_BASE_URL = required("QCMS_SCAFFOLD_ADMIN_BASE_URL");
const INTERNAL_TOKEN = required("QCMS_SCAFFOLD_INTERNAL_TOKEN");
const ADMIN_EMAIL = required("QCMS_SCAFFOLD_ADMIN_EMAIL");
const ADMIN_PASSWORD = required("QCMS_SCAFFOLD_ADMIN_PASSWORD");

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
 * What a browser sends on a state-changing portal POST, and what the BFF requires.
 *
 * SEC-9's CSRF belt (issue #487) refuses a POST that carries neither a
 * `Sec-Fetch-Site` of `same-origin` nor an `Origin` equal to `QCMS_PORTAL_BASE_URL`.
 * A raw `fetch` from a test runner sends neither, so this loop has to say what a
 * browser would. Sending the CONFIGURED base URL rather than the address this harness
 * dials is the point: it fails if the scaffolder put the wrong value in `.env`, which
 * is a thing only an adopter-shaped run can see.
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
    // The `Origin` header is required, and it has to be the admin origin: better-auth
    // validates state-changing calls against its `trustedOrigins`, which the API
    // configures from QCMS_ADMIN_BASE_URL. Sending it proves that value survived the
    // scaffold; sending anything else, or nothing, is a 403.
    //
    // The session token comes back in the RESPONSE BODY, not in the cookie: the cookie
    // value is `<token>.<signature>`, and it is the bare token that
    // `x-qcms-admin-session` wants.
    const signIn = await json(
      `${API}/api/auth/sign-in/email`,
      {
        method: "POST",
        headers: headers({ origin: ADMIN_BASE_URL }),
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      },
      [200],
    );
    expect(typeof signIn["token"]).toBe("string");
    adminSession = String(signIn["token"]);
  }, 60_000);

  // Not "on the ports the scaffold published": that is true on CI and false in the
  // dev container, where the harness reaches the stack over Compose's own network
  // because a host-loopback publish is unreachable from in here. What is asserted in
  // both environments is that the two applications are up and serving.
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

  it("completes the scenario-1 loop: author, publish, link, respond, submit, read back", async () => {
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

    // 2. Author a one-step form over it and publish it. Publishing is where the
    //    kernel compiles the A2UI document the portal will serve (ADR-18).
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

    // 3. Mint a secure link. The token exists only inside the returned URL, which is
    //    built from QCMS_PORTAL_BASE_URL, so this also proves the scaffolder put the
    //    operator's answer where the API reads it.
    const minted = await json(
      `${API}/admin/forms/${FORM_ID}/links`,
      {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ expiresAt: "2999-01-01T00:00:00.000Z", oneTime: false, count: 1 }),
      },
      [201, 200],
    );
    const links = minted["links"] as { url: string }[];
    expect(links).toHaveLength(1);
    const linkUrl = links[0]?.url ?? "";
    expect(linkUrl.startsWith(`${PORTAL_BASE_URL}/l/`)).toBe(true);

    // 4. Redeem it as a respondent, through the portal, exactly as a browser would.
    //    Dialled at this run's portal address rather than at the minted origin: the
    //    two are the same on CI and differ inside the dev container, and what the
    //    assertion above already proved is that the origin itself is right.
    const redeemed = await fetch(`${PORTAL}${new URL(linkUrl).pathname}`, { redirect: "manual" });
    expect(redeemed.status).toBe(303);
    const sessionCookie = (redeemed.headers.getSetCookie() ?? [])
      .map((cookie) => cookie.split(";")[0] ?? "")
      .join("; ");
    expect(sessionCookie).toContain("qcms_session=");
    // Next writes an absolute Location built from the request host, which inside the
    // container is the bind address rather than the public origin. Only the path is
    // ours to follow; the origin was already asserted on the minted link above.
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

    // 6. Read it back through the admin API. This is the whole loop closed: the
    //    answer a respondent gave through one container is visible to an author
    //    through another, over a database a third one migrated.
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
