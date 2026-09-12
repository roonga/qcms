import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A `429` from the auth mount reaches the screen as "too many attempts", never as
 * "wrong code" (issue #805).
 *
 * ## The defect this pins
 *
 * `POST /sign-in/submit` has always read the refusal's status and redirected with
 * `?throttled=1` for a `429`. Every other handler that reads an auth refusal read only
 * "did it refuse", so every refusal became the generic marker and the screen rendered the
 * one sentence that means the credential was wrong. That is not a cosmetic difference.
 * The advice a wrong-code message carries is "type it again", and typing it again is the
 * one action that keeps a throttle window shut - so the message actively worked against
 * the person reading it, on the only screen where they have no other move.
 *
 * It is reachable without an attacker. `/two-factor/*` has its own three-per-ten-seconds
 * bucket, and issue #482 records that on the default Compose shape there is no proxy, so
 * better-auth cannot resolve a client address and keys that bucket on a constant shared
 * by every operator. One colleague's retries therefore throttle everyone.
 *
 * ## All six readers, including the two Settings forms (issue #845)
 *
 * The three two-factor verify handlers were fixed by issue #805 and the two Settings
 * handlers were recorded here as justified exclusions: both are reached with a session
 * already established, so nobody is locked out, and the screen carries its own copy set.
 * The Code Owner ruled on 2026-09-12 that they render the sign-in throttled sentence too,
 * one throttled sentence app-wide and no new catalog key, so the exclusions became covered
 * cases and this file now pins every handler that reads a refusal.
 *
 * Those two are throttled by the same limiter for the same reason: SEC-1 puts
 * `/change-password` in the sign-in bucket and the recovery-codes call is
 * `/two-factor/generate-backup-codes`. What differs is the marker names. Both Settings
 * forms land their reader back on `/settings`, so the recovery-codes form carries a
 * `codesError`/`codesThrottled` pair of its own or its refusal would print under the
 * password form. The pairs are addresses, not vocabulary: both render the same two
 * sentences through `authFailureMessage`, which is what the sentence assertions below
 * check rather than taking the marker as a proxy for the message.
 *
 * ## Why this layer, and why not the browser suite
 *
 * The admin Playwright suite cannot see this at all: the harness runs with the sign-in
 * throttle off (`QCMS_ADMIN_SIGNIN_THROTTLE`, issue #390), so no `429` is producible
 * there, and turning it on would make every suite that signs in more than three times in
 * ten seconds flaky. The distinction is a property of one branch in a route handler
 * reading one status, so the handler driven directly with a stubbed refusal is the
 * highest layer that can actually reach it.
 *
 * The seam substituted is the auth mount and nothing else. `route-helpers.ts` is the real
 * module, so the `Location` asserted below is the header the browser would receive, and
 * `authFailureMessage` is the real mapping, so the sentence asserted is the one that
 * would be rendered into the screen.
 *
 * ## The pairing is the assertion
 *
 * Every route asserts both statuses. A handler that answered `?throttled=1`
 * unconditionally would satisfy a throttled-only test while destroying SEC-1's
 * indistinguishability, so "a wrong code still reports the generic failure" is checked
 * beside it on every route rather than once.
 */

const ADMIN_BASE = "https://admin.qcms.test";

/** The configuration the real `./config.ts` reads. Not stubbed away: see `origin-guard.test.ts`. */
function stubAdminEnv(): void {
  vi.stubEnv("QCMS_ADMIN_BASE_URL", ADMIN_BASE);
  vi.stubEnv("QCMS_API_BASE_URL", "http://api.internal");
  vi.stubEnv("QCMS_INTERNAL_TOKEN", "internal-token");
}

stubAdminEnv();
beforeEach(stubAdminEnv);
afterEach(() => {
  vi.unstubAllEnvs();
});

const seams = {
  signInEmail: vi.fn(),
  verifyTotp: vi.fn(),
  verifyBackupCode: vi.fn(),
  enableTwoFactor: vi.fn(),
  proxiedSession: vi.fn(),
  generateBackupCodes: vi.fn(),
  changePassword: vi.fn(),
  signOut: vi.fn(),
};

vi.mock("@/lib/server/auth-api", () => ({
  signInEmail: seams.signInEmail,
  verifyTotp: seams.verifyTotp,
  verifyBackupCode: seams.verifyBackupCode,
  enableTwoFactor: seams.enableTwoFactor,
  proxiedSession: seams.proxiedSession,
  generateBackupCodes: seams.generateBackupCodes,
  changePassword: seams.changePassword,
  signOut: seams.signOut,
}));

/**
 * The request scope Next gives a route handler, which a direct call has none of.
 *
 * `requireAdminSessionForRequest` is the real module here (the two Settings handlers apply
 * the shell's session policy themselves, issue #177, and stubbing that out would leave the
 * test asserting a handler that production does not run), and it reads `headers()`. Only
 * the accessor is substituted; the policy above it and the session it reads are real, the
 * latter coming back through the mocked auth mount below like every other seam.
 */
vi.mock("next/headers", () => ({
  headers: (): Promise<Headers> => Promise.resolve(new Headers()),
}));

vi.mock("@/lib/server/enrollment", () => ({
  pendingEnrollmentCookie: (): string => "qcms_admin.enrollment=uri; Path=/",
  recoveryCodesCookie: (): string => "qcms_admin.recovery_codes=%5B%5D; Path=/",
  clearEnrollmentCookie: (): string => "qcms_admin.enrollment=; Max-Age=0; Path=/",
  clearRecoveryCodesCookie: (): string => "qcms_admin.recovery_codes=; Max-Age=0; Path=/",
}));

const signInRoute = await import("../../app/sign-in/submit/route.ts");
const challengeRoute = await import("../../app/two-factor/challenge/verify/route.ts");
const enrollRoute = await import("../../app/two-factor/enroll/verify/route.ts");
const recoveryRoute = await import("../../app/two-factor/recovery/verify/route.ts");
const passwordRoute = await import("../../app/(shell)/settings/password/route.ts");
const codesRoute = await import("../../app/(shell)/settings/recovery-codes/route.ts");
const { authFailureMessage } = await import("../auth-failure-message.ts");
const { messages } = await import("../i18n/en.ts");

/**
 * A refusal as the API's auth mount returns one: a status and a body, never a throw.
 *
 * `asResponse: true` is what makes that true, and it is the trap `authRefused`'s docblock
 * records - so the fixture reproduces the real shape rather than a rejected promise,
 * because a rejected promise would exercise a path production never takes.
 */
function refusal(status: number): Response {
  return new Response(JSON.stringify({ message: "refused" }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A same-origin form POST, which is what every auth screen sends. */
function formPost(path: string, fields: Record<string, string>): Request {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return new Request(`${ADMIN_BASE}${path}`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
    body,
  });
}

/**
 * The two query markers a handler reports its two refusal states with.
 *
 * The auth screens carry one form each, so they all use this pair.
 */
const SHARED_MARKERS = { throttled: "throttled", refused: "error" } as const;

/**
 * The Settings recovery-codes form's pair (issue #845).
 *
 * Two forms on one screen, both landing back on `/settings`: without a second pair the
 * recovery-codes refusal would render under the password form, and the marker also decides
 * which panel opens (`lib/settings-sections.ts`). Different names, same two states, same
 * two sentences.
 */
const CODES_MARKERS = { throttled: "codesThrottled", refused: "codesError" } as const;

/** One handler that turns an auth-mount refusal into a redirect a screen can read. */
interface RefusingRoute {
  /** Repo-relative source path, so a red names the file to open. */
  readonly path: string;
  /** The screen a refusal lands on, without its marker. */
  readonly screen: string;
  /** The names this handler reports the two states under. */
  readonly markers: { readonly throttled: string; readonly refused: string };
  /** Arm the auth-mount call this handler makes with the given refusal. */
  readonly refuseWith: (status: number) => void;
  readonly post: () => Promise<Response>;
}

/**
 * The sentence a screen would render from a redirect this handler produced.
 *
 * The marker is read back out of the `Location` and put through the real mapping under the
 * handler's own marker names, which is exactly what the screen does with it: the password
 * panel reads `throttled`/`error` and the recovery-codes panel reads its `codes*` pair
 * (`app/(shell)/settings/page.tsx`). Asserting the sentence rather than only the marker is
 * what makes the second pair worth having - a `codesThrottled` nothing maps to would pass
 * a marker-only assertion while showing the operator no message at all.
 */
function sentenceRenderedFor(route: RefusingRoute, response: Response): string | undefined {
  const location = response.headers.get("location") ?? "";
  const query = new URL(location, ADMIN_BASE).searchParams;
  return authFailureMessage({
    throttled: query.get(route.markers.throttled) ?? undefined,
    error: query.get(route.markers.refused) ?? undefined,
  });
}

const ROUTES: readonly RefusingRoute[] = [
  {
    path: "app/sign-in/submit/route.ts",
    screen: "/sign-in",
    markers: SHARED_MARKERS,
    refuseWith: (status) => seams.signInEmail.mockResolvedValue(refusal(status)),
    post: () =>
      signInRoute.POST(
        formPost("/sign-in/submit", {
          email: "admin@example.test",
          password: "correct horse battery staple",
        }),
      ),
  },
  {
    path: "app/two-factor/challenge/verify/route.ts",
    screen: "/two-factor/challenge",
    markers: SHARED_MARKERS,
    refuseWith: (status) => seams.verifyTotp.mockResolvedValue(refusal(status)),
    post: () => challengeRoute.POST(formPost("/two-factor/challenge/verify", { code: "123456" })),
  },
  {
    path: "app/two-factor/enroll/verify/route.ts",
    screen: "/two-factor/enroll",
    markers: SHARED_MARKERS,
    refuseWith: (status) => seams.verifyTotp.mockResolvedValue(refusal(status)),
    post: () => enrollRoute.POST(formPost("/two-factor/enroll/verify", { code: "123456" })),
  },
  {
    path: "app/two-factor/recovery/verify/route.ts",
    screen: "/two-factor/recovery",
    markers: SHARED_MARKERS,
    refuseWith: (status) => seams.verifyBackupCode.mockResolvedValue(refusal(status)),
    post: () => recoveryRoute.POST(formPost("/two-factor/recovery/verify", { code: "aaaa-bbbb" })),
  },
  {
    // Reached with a session, which is why it was excluded until the 2026-09-12 ruling. The
    // marker pair is the shared one: this form owns the panel the pair opens.
    path: "app/(shell)/settings/password/route.ts",
    screen: "/settings",
    markers: SHARED_MARKERS,
    refuseWith: (status) => seams.changePassword.mockResolvedValue(refusal(status)),
    post: () =>
      passwordRoute.POST(
        formPost("/settings/password", {
          currentPassword: "correct horse battery staple",
          newPassword: "a much longer replacement",
        }),
      ),
  },
  {
    path: "app/(shell)/settings/recovery-codes/route.ts",
    screen: "/settings",
    markers: CODES_MARKERS,
    refuseWith: (status) => seams.generateBackupCodes.mockResolvedValue(refusal(status)),
    post: () =>
      codesRoute.POST(
        formPost("/settings/recovery-codes", { password: "correct horse battery staple" }),
      ),
  },
];

/**
 * The session the two Settings handlers require before they reach the auth mount at all.
 *
 * Enrolled and freshly issued, so all three gates in `./session.ts` pass: an unenrolled or
 * aged session would redirect to enrollment or sign-in and the refusal under test would
 * never be produced.
 */
function signedInSession(): unknown {
  return {
    session: { createdAt: new Date().toISOString(), token: "session-token" },
    user: {
      id: "usr_1",
      email: "admin@example.test",
      name: "Admin",
      role: "admin",
      twoFactorEnabled: true,
    },
  };
}

beforeEach(() => {
  for (const seam of Object.values(seams)) seam.mockReset();
  seams.proxiedSession.mockResolvedValue(signedInSession());
});

describe.each(ROUTES)("$path", (route) => {
  it("redirects with the throttled marker when the auth mount answers 429", async () => {
    route.refuseWith(429);
    const response = await route.post();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${route.screen}?${route.markers.throttled}=1`);
    // And that marker is one the screen has a sentence for: the message the operator reads
    // is what the issue is about, and it is the same sentence on all six routes.
    expect(sentenceRenderedFor(route, response)).toBe(messages["signIn.throttled"]);
  });

  it("still redirects with the generic marker when the credential was refused", async () => {
    // SEC-1's indistinguishability, asserted on every route beside the case above: the
    // throttled marker must be the 429's alone, or the fix would have traded a wrong
    // message for an oracle.
    route.refuseWith(401);
    const response = await route.post();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${route.screen}?${route.markers.refused}=1`);
    expect(sentenceRenderedFor(route, response)).toBe(messages["signIn.error"]);
  });

  it("issues no cookies on either refusal", async () => {
    // A refusal that carried a `Set-Cookie` would be a session or challenge state change
    // on a request the auth mount declined, whichever marker it chose.
    for (const status of [429, 401]) {
      route.refuseWith(status);
      expect((await route.post()).headers.getSetCookie()).toEqual([]);
    }
  });
});

describe("the marker the screen reads", () => {
  it("renders the throttled sentence, which tells the operator to wait rather than retype", () => {
    expect(authFailureMessage({ throttled: "1" })).toBe(messages["signIn.throttled"]);
  });

  it("renders the generic failure sentence for the credential refusal", () => {
    expect(authFailureMessage({ error: "1" })).toBe(messages["signIn.error"]);
  });

  it("prefers throttled over a marker that would understate it", () => {
    // A redirect carrying both is not produced today. The ordering is asserted anyway
    // because the failure it prevents is silent: the weaker sentence is the one that
    // invites another attempt.
    expect(authFailureMessage({ throttled: "1", error: "1" })).toBe(messages["signIn.throttled"]);
  });

  it("shows nothing on a first visit", () => {
    expect(authFailureMessage({})).toBeUndefined();
  });

  it("keeps the two sentences distinct", () => {
    // The whole fix is that these differ. If a future edit collapsed the copy, every
    // assertion above would still pass while the operator saw no change at all.
    expect(messages["signIn.throttled"]).not.toBe(messages["signIn.error"]);
  });
});

/**
 * Which handlers are in scope, derived from disk rather than from this file's table.
 *
 * A route added later that reads an auth-mount refusal is exactly the place this defect
 * reappears, and it would reappear silently: the new handler would pass every test above
 * by not being in them. So the set is read off the tree and has to be accounted for.
 */
describe("every admin handler that reads an auth refusal is accounted for", () => {
  it("is the table above and nothing else, with no exclusions left", () => {
    // There were two, both Settings handlers, recorded here when issue #805 shipped. The
    // 2026-09-12 ruling folded them in, so the set is now the whole table: a handler added
    // later has to join it rather than earn a paragraph.
    const appDir = fileURLToPath(new URL("../../app/", import.meta.url));
    const handlers = readdirSync(appDir, { recursive: true, encoding: "utf8" })
      .filter((entry) => entry.endsWith("route.ts"))
      .filter((entry) => readFileSync(`${appDir}${entry}`, "utf8").includes("authRefused"))
      .map((entry) => `app/${entry.split("\\").join("/")}`);

    const order = (a: string, b: string): number => a.localeCompare(b);
    expect([...handlers].sort(order)).toEqual([...ROUTES.map((route) => route.path)].sort(order));
  });
});
