#!/usr/bin/env node
// @ts-check
/**
 * The operator environment reference (task 036 exit criterion 2, from 017's config
 * schema).
 *
 * ## The problem this exists to solve
 *
 * An env table in a document is wrong the day after it is written. Someone adds a
 * knob to `apps/api/src/config.ts`, ships it, and the ops guide silently describes
 * a deployment that no longer exists. The failure is invisible: nothing is red, the
 * doc simply lies, and an operator finds out during an incident.
 *
 * So the table is generated from here and asserted against the source in
 * `env-reference.test.ts`, along three axes:
 *
 *   1. **Names.** {@link scanEnvNames} reads every tracked, non-test source file of
 *      an app and reports every environment variable it actually touches. That set
 *      must equal the set this file documents, in both directions. Add a knob and
 *      forget the doc, and the test fails naming it; delete a knob and leave the
 *      row behind, and it fails the other way.
 *   2. **Requirement.** For the API, the *parser helper* a variable is read through
 *      says whether it is required or optional ({@link REQUIREMENT_BY_HELPER}), and
 *      that classification is checked against the `requirement` column. Change
 *      `parseInt_` to `parseRequiredString` and the doc has to follow.
 *   3. **The rendered block.** `docs/operations.md` carries the output of
 *      {@link renderEnvReference} between two markers, compared byte for byte.
 *
 * What is NOT derived is the prose: descriptions and default values are written by
 * hand below, because a useful description cannot be extracted from a parser call.
 * Names and requirement are the parts that drift silently, and those are the parts
 * the machine owns.
 *
 * ## Usage
 *
 *   node scripts/env-reference.mjs           print the generated block
 *   node scripts/env-reference.mjs --write   rewrite the block in docs/operations.md
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { REPOSITORY_ROOT } from "./docker.mjs";

/** The document that carries the generated block. */
export const OPERATIONS_DOC = "docs/operations.md";

/** Fence markers around the generated block; everything between them is machine-owned. */
export const BEGIN_MARKER =
  "<!-- BEGIN GENERATED: env-reference (node scripts/env-reference.mjs --write) -->";
export const END_MARKER = "<!-- END GENERATED: env-reference -->";

/**
 * Compose files whose `${VAR}` interpolation is part of the operator surface.
 *
 * `docker-compose.dev-tools.yml` is deliberately absent, and the omission is a
 * decision rather than an oversight (issue #417). This list decides what appears in
 * an OPERATOR's reference, and none of that overlay's variables is an operator's to
 * set: it is a developer's toolbox that never runs in a deployment, so a row for it
 * in `docs/operations.md` would document a knob for a stack the reader does not
 * have. Its variables are documented in `docs/DEVELOPER_GUIDE.md` instead, where the
 * audience is. `docker-compose.dev.yml` is absent for the same reason and always was.
 *
 * The overlay's one shared name, `OTEL_EXPORTER_OTLP_ENDPOINT`, is already in the
 * table twice (once for each app that reads it) via the base file, so the operator
 * surface loses nothing by the exclusion.
 */
const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.proxy.yml"];

/**
 * Where each process's environment reads live. A DIRECTORY, deliberately, not a
 * file list: a hand-maintained list of files is the same drift the whole module
 * exists to prevent, and a new module reading `process.env` would slip past it.
 */
const SOURCE_ROOTS = {
  api: ["apps/api/src"],
  portal: ["apps/portal"],
  admin: ["apps/admin"],
};

/** Test, fixture and browser-spec files: their env reads are harness business. */
const NOT_PRODUCTION_SOURCE = /(\.test\.|\.spec\.|\.pw\.|\/e2e\/|\/__|test-support)/;

/**
 * Which parser helper in `apps/api/src/config.ts` implies which requirement.
 *
 * This is the coupling that makes axis 2 above real: the helper name IS the
 * validation contract (a `parseRequired*` records an issue when the variable is
 * absent; a `parse*` with a fallback cannot). A variable read outside these helpers
 * is left unclassified and only its NAME is checked.
 */
export const REQUIREMENT_BY_HELPER = {
  parseRequiredString: "required",
  parseKeyList: "required",
  parseRequiredHttpUrl: "required",
  parseOptionalString: "optional",
  parseBool: "optional",
  parseInt_: "optional",
  parseRateClass: "optional",
};

/**
 * @typedef {object} EnvVar
 * @property {string} name
 * @property {"api" | "portal" | "admin" | "compose"} process which process reads it.
 * @property {"required" | "optional" | "conditional"} requirement
 * @property {string} fallback the default, or "" when there is none.
 * @property {boolean} [secret] true when the value is key material (SEC-7/SEC-8).
 * @property {string} description
 */

/**
 * Every environment variable an operator can set, with the prose the generated
 * table renders. Order within a process group is the order it is rendered in:
 * required first, then optional, roughly by how often an operator touches it.
 *
 * @type {readonly EnvVar[]}
 */
export const ENV_REFERENCE = [
  // --- API (task 017's composition root) ------------------------------------
  {
    name: "DATABASE_URL",
    process: "api",
    requirement: "required",
    fallback: "",
    secret: true,
    description:
      "Postgres connection string. The API is the only process in either topology that holds one (ADR-35). Compose builds it from the `QCMS_DB_*` values.",
  },
  {
    name: "QCMS_MOUNT",
    process: "api",
    requirement: "required",
    fallback: "",
    description:
      "Which route groups this process serves: a comma-separated list of `public`, `internal`, `admin`, or the shortcut `all`. Unmounted routes do not exist (404, not 403 - ADR-09). The outbox deliverer and retention sweep run in the process that mounts `internal`.",
  },
  {
    name: "QCMS_LINK_KEYS",
    process: "api",
    requirement: "required",
    fallback: "",
    secret: true,
    description:
      "Secure-link signing keys, at least 32 characters each. Comma-separated: the first signs, all verify. Rotation runbook: `docs/secure-links.md`.",
  },
  {
    name: "QCMS_SESSION_KEYS",
    process: "api",
    requirement: "required",
    fallback: "",
    secret: true,
    description:
      "Respondent session-token signing keys, at least 32 characters each. Same first-signs-all-verify rotation model as `QCMS_LINK_KEYS`.",
  },
  {
    name: "QCMS_INTERNAL_TOKEN",
    process: "api",
    requirement: "required",
    fallback: "",
    secret: true,
    description:
      "Service tokens the BFFs present on every internal call (SEC-4), at least 32 characters each. Any listed token is accepted, which is what makes rotation a two-deploy operation.",
  },
  {
    name: "QCMS_APP_KEY",
    process: "api",
    requirement: "required",
    fallback: "",
    secret: true,
    description:
      "AES-256-GCM key (at least 32 characters) encrypting secrets at rest: webhook signing secrets and stored TOTP material (SEC-6). Changing it makes every existing at-rest secret undecryptable.",
  },
  {
    name: "QCMS_PORTAL_BASE_URL",
    process: "api",
    requirement: "required",
    fallback: "",
    description:
      "Public origin of the respondent portal, used to build the secure-link URLs authors copy. Absolute http(s); a trailing slash is stripped.",
  },
  {
    name: "QCMS_ADMIN_AUTH_SECRET",
    process: "api",
    requirement: "conditional",
    fallback: "",
    secret: true,
    description:
      "better-auth signing secret, at least 32 characters. Required when `QCMS_MOUNT` includes `admin`. It also protects stored two-factor material (TOTP secrets and recovery codes are encrypted under it), so back it up with the database. Rotate it through `QCMS_ADMIN_AUTH_SECRETS` rather than by editing this value, which would leave every enrolled authenticator unreadable (SEC-7).",
  },
  {
    name: "QCMS_ADMIN_AUTH_SECRETS",
    process: "api",
    requirement: "optional",
    fallback: "unset - version 1 holds QCMS_ADMIN_AUTH_SECRET",
    secret: true,
    description:
      "Versioned admin auth keys for non-destructive rotation, as comma-separated `<version>:<secret>` entries, newest first (for example `2:<new>,1:<old>`). The first entry encrypts new material; the rest stay readable. Each value has the same 32-character floor. Leave it unset unless you are rotating; the rotation runbook is in the key-rotation section below (SEC-7, issue #319).",
  },
  {
    name: "QCMS_ADMIN_BASE_URL",
    process: "api",
    requirement: "conditional",
    fallback: "",
    description:
      "Public origin of the **admin app**, not of this API. Required when `QCMS_MOUNT` includes `admin`: it is the origin better-auth scopes cookies to and the only origin it trusts, so it must match what the browser sees exactly.",
  },
  {
    name: "TURNSTILE_SITE_KEY",
    process: "api",
    requirement: "conditional",
    fallback: "",
    description:
      "Turnstile site key. Required when `QCMS_FLAG_CHALLENGE_PROVIDER=turnstile`, ignored otherwise.",
  },
  {
    name: "TURNSTILE_SECRET_KEY",
    process: "api",
    requirement: "conditional",
    fallback: "",
    secret: true,
    description:
      "Turnstile verification secret. Required when `QCMS_FLAG_CHALLENGE_PROVIDER=turnstile`, ignored otherwise.",
  },
  {
    name: "PORT",
    process: "api",
    requirement: "optional",
    fallback: "3000",
    description:
      "TCP port the API listens on inside its container. `QCMS_PORT` is accepted as a fallback spelling. The images expose 3000 and Compose never republishes it.",
  },
  {
    name: "QCMS_PORT",
    process: "api",
    requirement: "optional",
    fallback: "3000",
    description: "Prefixed alias for `PORT`, read only when `PORT` is unset.",
  },
  {
    name: "NODE_ENV",
    process: "api",
    requirement: "optional",
    fallback: "production (set by the image)",
    description:
      "Decides the default for `QCMS_ADMIN_SECURE_COOKIES` when that is unset. The production Dockerfiles set it; do not unset it in a deployment.",
  },
  {
    name: "QCMS_FLAG_CHALLENGE_PROVIDER",
    process: "api",
    requirement: "optional",
    fallback: "none",
    description:
      "Abuse-control challenge provider (ADR-24 registry): `none` or `turnstile`. An unknown `QCMS_FLAG_*` variable fails boot rather than being ignored.",
  },
  {
    name: "QCMS_ADMIN_2FA",
    process: "api",
    requirement: "optional",
    fallback: "required",
    description:
      "Administrator TOTP policy (SEC-1): `required` or `optional`. `optional` is a development escape hatch, never a production setting.",
  },
  {
    name: "QCMS_ADMIN_SECURE_COOKIES",
    process: "api",
    requirement: "optional",
    fallback: "true when NODE_ENV=production",
    description:
      "Whether cookies set on the admin origin carry `Secure`. It describes the **browser-facing** scheme, which this process cannot observe, so it is a knob rather than only an inference. Must hold the same value in the `api` and `admin` services or the browser keeps one cookie family and drops the other. The `admin` service refuses to start when it is false at a non-loopback `QCMS_ADMIN_BASE_URL` (issue #292), so a downgrade here is refused by the process the browser actually reaches.",
  },
  {
    name: "QCMS_ADMIN_PASSWORD_BREACH_CHECK",
    process: "api",
    requirement: "optional",
    fallback: "true",
    description:
      "Whether an admin password is checked against the public breach corpus before it is accepted (SEC-1; NIST SP 800-63B Rev 4 3.1.1.2, OWASP ASVS 5.0 6.2.12). When on, setting a password makes one HTTPS request to `api.pwnedpasswords.com/range/{prefix}` carrying the first five hex characters of the password's SHA-1 and nothing else; the password never leaves the process. **The check fails closed**: if that host is unreachable the password is refused, so on an air-gapped deployment `qcms:create-admin` cannot create the first admin at all until you set this to `false`. Doing so is a documented downgrade against both standards, supported for a structurally offline deployment and as the break-glass for rotating a leaked password while the corpus is unreachable; the API and the CLI each log a loud warning at startup for as long as it is off.",
  },
  {
    name: "QCMS_ADMIN_SESSION_IDLE_MS",
    process: "api",
    requirement: "optional",
    fallback: "3600000 (1h)",
    description: "Idle window before an administrator session expires (SEC-1).",
  },
  {
    name: "QCMS_ADMIN_SESSION_MAX_AGE_MS",
    process: "api",
    requirement: "optional",
    fallback: "43200000 (12h)",
    description:
      "Absolute administrator session lifetime measured from issue (SEC-1). Past it every admin call is a 401 regardless of activity, which is the cap an idle window alone cannot provide.",
  },
  {
    name: "QCMS_SESSION_TTL_MS",
    process: "api",
    requirement: "optional",
    fallback: "86400000 (24h)",
    description: "Lifetime of an anonymous respondent session.",
  },
  {
    name: "QCMS_WEBHOOK_ALLOW_PRIVATE",
    process: "api",
    requirement: "optional",
    fallback: "false",
    description:
      "SSRF override (SEC-6). While false, webhook targets must be HTTPS and must not resolve to private, reserved, loopback or link-local hosts. Set true only for an on-prem topology that legitimately posts to an internal system.",
  },
  {
    name: "QCMS_WEBHOOK_TIMEOUT_MS",
    process: "api",
    requirement: "optional",
    fallback: "10000",
    description: "Per-attempt webhook delivery timeout. A slower response is a failed attempt.",
  },
  {
    name: "QCMS_WEBHOOK_BATCH_SIZE",
    process: "api",
    requirement: "optional",
    fallback: "20",
    description:
      "Deliveries one outbox pass processes. Bounds the row locks held per tick; the interval drains the rest.",
  },
  {
    name: "QCMS_OUTBOX_INTERVAL_MS",
    process: "api",
    requirement: "optional",
    fallback: "5000",
    description: "How often the outbox deliverer runs, in the process that mounts `internal`.",
  },
  {
    name: "QCMS_OUTBOX_JITTER_MS",
    process: "api",
    requirement: "optional",
    fallback: "1000",
    description:
      "Random jitter added to the outbox interval, so several API instances do not tick in lockstep.",
  },
  {
    name: "QCMS_RETENTION_SWEEP_INTERVAL_MS",
    process: "api",
    requirement: "optional",
    fallback: "3600000 (1h)",
    description:
      "How often the retention sweep runs: expired anonymous sessions, aged webhook response snippets, and aged outbox payloads.",
  },
  {
    name: "QCMS_DELIVERY_SNIPPET_TTL_MS",
    process: "api",
    requirement: "optional",
    fallback: "604800000 (7d)",
    description:
      "How long a webhook delivery keeps the stored prefix of the consumer's response body, measured from the attempt. That body can echo a respondent's answers back, so it ages out; the rest of the attempt record is value-free and is kept. `0` removes it at the next sweep.",
  },
  {
    name: "QCMS_OUTBOX_PAYLOAD_TTL_MS",
    process: "api",
    requirement: "optional",
    fallback: "2592000000 (30d)",
    description:
      "How long a settled outbox event keeps the answers its payload carries, measured from the moment the event and its whole fan-out stopped moving. The payload is a second copy of the respondent's answers kept only so a delivery can be re-sent, so it ages out with that capability; the envelope and the delivery record are kept. `0` drops them as soon as the fan-out settles.",
  },
  {
    name: "QCMS_READY_DB_TIMEOUT_MS",
    process: "api",
    requirement: "optional",
    fallback: "2000",
    description:
      "Timeout for the `/ready` database probe. Exceeding it makes `/ready` answer 503, never 500.",
  },
  {
    name: "QCMS_BODY_LIMIT_BYTES",
    process: "api",
    requirement: "optional",
    fallback: "1000000 (1MB)",
    description:
      "Maximum request body the API accepts (SEC-9). Keep the ingress ceiling in step with it: both recipes set one.",
  },
  {
    name: "QCMS_ANTIABUSE_MIN_SUBMIT_MS",
    process: "api",
    requirement: "optional",
    fallback: "0 (off)",
    description:
      "Global floor on the gap between session start and submit. A faster submit is silently flagged; a form may set its own floor that overrides this.",
  },
  {
    name: "QCMS_ANTIABUSE_HONEYPOT_FIELD",
    process: "api",
    requirement: "optional",
    fallback: "the compiler's HONEYPOT_FIELD_NAME",
    description:
      "Name of the decoy submit field. It is a contract between the compiler and the API, so override it only if you also change the compiler constant.",
  },
  {
    name: "QCMS_RL_SESSION_CREATE_WINDOW_MS",
    process: "api",
    requirement: "optional",
    fallback: "3600000 (1h)",
    description:
      "Rate-limit window for `POST /sessions`. Keyed by the client address the portal BFF vouched for: see `QCMS_RL_SESSION_CREATE_MAX`.",
  },
  {
    name: "QCMS_RL_SESSION_CREATE_MAX",
    process: "api",
    requirement: "optional",
    fallback: "20",
    description:
      "Sessions one client address may start per window. The limiter keys on the address the portal BFF vouched for, which it resolves from the ingress's `X-Forwarded-For` by counting `QCMS_PORTAL_TRUSTED_PROXY_HOPS` entries from the right - a client-supplied value cannot move the bucket. **Behind no ingress at all** (the local Compose quickstart, or a deployment where the ingress writes no forwarded header) there is no address to vouch for and every respondent shares one `unknown-ip` bucket, making this a whole-deployment ceiling of 20 session starts per hour: set the ingress up per `docs/deploy-ingress.md`, or raise this to your expected peak.",
  },
  {
    name: "QCMS_RL_ANSWERS_SESSION_WINDOW_MS",
    process: "api",
    requirement: "optional",
    fallback: "5000",
    description: "Rate-limit window for answer submission, keyed by session.",
  },
  {
    name: "QCMS_RL_ANSWERS_SESSION_MAX",
    process: "api",
    requirement: "optional",
    fallback: "10",
    description:
      "Answers one session may submit per window (a burst ceiling, about 2/s sustained).",
  },
  {
    name: "QCMS_RL_ANSWERS_IP_WINDOW_MS",
    process: "api",
    requirement: "optional",
    fallback: "60000",
    description:
      "Rate-limit window for answer submission, keyed the same way as `QCMS_RL_SESSION_CREATE_MAX` and subject to the same no-ingress caveat.",
  },
  {
    name: "QCMS_RL_ANSWERS_IP_MAX",
    process: "api",
    requirement: "optional",
    fallback: "300",
    description:
      "Answers that may be submitted per window across every session sharing one client address: the wide backstop against many-session floods from one source. Keyed and caveated exactly as `QCMS_RL_SESSION_CREATE_MAX`; the per-session limits above are unaffected either way, because a session id is always visible.",
  },
  {
    name: "QCMS_RL_SUBMIT_SESSION_WINDOW_MS",
    process: "api",
    requirement: "optional",
    fallback: "60000",
    description: "Rate-limit window for `POST /sessions/{id}/submit`, keyed by session.",
  },
  {
    name: "QCMS_RL_SUBMIT_SESSION_MAX",
    process: "api",
    requirement: "optional",
    fallback: "5",
    description: "Submit attempts one session may make per window.",
  },
  {
    name: "OTEL_EXPORTER_OTLP_ENDPOINT",
    process: "api",
    requirement: "optional",
    fallback: "",
    description:
      "OTLP collector endpoint (ADR-34). Unset is the default and a hard no-op: no SDK starts and no span is produced. Setting it turns on tracing and adds `trace_id`/`span_id` to every log line.",
  },
  {
    name: "OTEL_SERVICE_NAME",
    process: "api",
    requirement: "optional",
    fallback: "qcms-api",
    description: "Service name reported on exported spans. Read only when tracing is on.",
  },
  {
    name: "QCMS_ADMIN_EMAIL",
    process: "api",
    requirement: "conditional",
    fallback: "",
    description:
      "First-run bootstrap only. Read by `node dist/create-admin.js` to create the first administrator; never read by the serving process.",
  },
  {
    name: "QCMS_ADMIN_PASSWORD",
    process: "api",
    requirement: "conditional",
    fallback: "",
    secret: true,
    description:
      "First-run bootstrap only, alongside `QCMS_ADMIN_EMAIL`. Pass it per-command (`docker compose exec --env`), never in the `.env` file.",
  },
  {
    name: "QCMS_ADMIN_NAME",
    process: "api",
    requirement: "optional",
    fallback: "the email local part",
    description: "Display name for the bootstrapped administrator.",
  },

  // --- Portal (BFF) ----------------------------------------------------------
  {
    name: "QCMS_API_BASE_URL",
    process: "portal",
    requirement: "required",
    fallback: "",
    description:
      "Internal origin of the API. On the Compose network this is `http://api:3000`; it is never a public URL.",
  },
  {
    name: "QCMS_INTERNAL_TOKEN",
    process: "portal",
    requirement: "required",
    fallback: "",
    secret: true,
    description:
      "The service token this BFF presents to the API (SEC-4). Must be one of the tokens the API accepts.",
  },
  {
    name: "QCMS_PORTAL_BASE_URL",
    process: "portal",
    requirement: "required",
    fallback: "",
    description:
      "This app's own public origin, used to build the redirects a browser follows. Getting it wrong emits a container-internal address a browser cannot reach.",
  },
  {
    name: "QCMS_PORTAL_TRUSTED_PROXY_HOPS",
    process: "portal",
    requirement: "optional",
    fallback: "1",
    description:
      "How many proxies you run between the internet and this app. The client address the API's rate limiters key on is the entry that many places from the **right** of the inbound `X-Forwarded-For`, so entries a client wrote itself are never reached. `1` is correct for both recipes in `docs/deploy-ingress.md`. **Setting it higher than the number of proxies that actually exist makes per-address rate limiting bypassable** (the resolver reads into client-supplied text); setting it lower is safe but coarse (respondents get bucketed by a proxy's egress address); `0` trusts no forwarded header and puts every respondent in one bucket. A non-numeric or out-of-range value is refused rather than defaulted.",
  },
  {
    name: "QCMS_SECURE_COOKIES",
    process: "portal",
    requirement: "optional",
    fallback: "true when NODE_ENV=production",
    description:
      "Whether respondent session cookies carry `Secure`. Setting it false is a downgrade, supported only when `QCMS_PORTAL_BASE_URL` is a loopback origin such as `http://localhost:7000`: at any other origin the portal **refuses to start**, naming this variable (issue #292). Leave it unset behind TLS.",
  },
  {
    name: "NODE_ENV",
    process: "portal",
    requirement: "optional",
    fallback: "production (set by the image)",
    description: "Decides the default for `QCMS_SECURE_COOKIES` when that is unset.",
  },
  {
    name: "QCMS_FLAG_CHALLENGE_PROVIDER",
    process: "portal",
    requirement: "optional",
    fallback: "none",
    description:
      "Must match the API's value. `turnstile` makes the portal render the widget; anything else renders none.",
  },
  {
    name: "QCMS_TURNSTILE_SITE_KEY",
    process: "portal",
    requirement: "conditional",
    fallback: "",
    description:
      "Turnstile site key for the rendered widget. Required when the portal's challenge provider is `turnstile`. Note the prefix: the API reads the same key under the unprefixed `TURNSTILE_SITE_KEY`, so today you set both. Issue #331 consolidates the two spellings onto this prefixed one.",
  },
  {
    name: "QCMS_PORTAL_THEME",
    process: "portal",
    requirement: "optional",
    fallback: "slate",
    description: "Managed portal theme (ADR-30). An unrecognised value falls back silently.",
  },
  {
    name: "QCMS_PORTAL_MODE",
    process: "portal",
    requirement: "optional",
    fallback: "auto",
    description: "Default light/dark mode: `light`, `dark` or `auto`.",
  },
  {
    name: "QCMS_PORTAL_CORNERS",
    process: "portal",
    requirement: "optional",
    fallback: "subtle",
    description: "Corner-radius token group.",
  },
  {
    name: "QCMS_PORTAL_DENSITY",
    process: "portal",
    requirement: "optional",
    fallback: "the @qcms/ui default density",
    description: "Spacing token group.",
  },
  {
    name: "QCMS_PORTAL_FONTS",
    process: "portal",
    requirement: "optional",
    fallback: "",
    description: "Font stack selection from the allowlist in `apps/portal/lib/server/theme.ts`.",
  },
  {
    name: "QCMS_PORTAL_FONT",
    process: "portal",
    requirement: "optional",
    fallback: "the system font stack",
    description: "Single font family override.",
  },
  {
    name: "QCMS_PORTAL_BRAND_NAME",
    process: "portal",
    requirement: "optional",
    fallback: "",
    description: "Brand name shown in the portal header. Empty renders no brand.",
  },
  {
    name: "QCMS_PORTAL_BRAND_LOGO",
    process: "portal",
    requirement: "optional",
    fallback: "",
    description: "URL of the brand logo shown in the portal header.",
  },
  {
    name: "OTEL_EXPORTER_OTLP_ENDPOINT",
    process: "portal",
    requirement: "optional",
    fallback: "",
    description: "OTLP collector endpoint (ADR-34). Unset means no SDK and no spans.",
  },
  {
    name: "OTEL_SERVICE_NAME",
    process: "portal",
    requirement: "optional",
    fallback: "qcms-portal",
    description: "Service name reported on exported spans.",
  },

  // --- Admin (BFF) -----------------------------------------------------------
  {
    name: "QCMS_API_BASE_URL",
    process: "admin",
    requirement: "required",
    fallback: "",
    description:
      "Internal origin of the API. Since task 056 this is the admin's only route to data of any kind: it holds no database credential (ADR-35).",
  },
  {
    name: "QCMS_INTERNAL_TOKEN",
    process: "admin",
    requirement: "required",
    fallback: "",
    secret: true,
    description: "The service token this BFF presents to the API (SEC-4).",
  },
  {
    name: "QCMS_ADMIN_BASE_URL",
    process: "admin",
    requirement: "required",
    fallback: "",
    description:
      "This app's own public origin. Used for the SEC-9 origin check on state-changing routes, and it must equal the value the API is given.",
  },
  {
    name: "QCMS_ADMIN_SECURE_COOKIES",
    process: "admin",
    requirement: "optional",
    fallback: "true when NODE_ENV=production",
    description:
      "Whether the cookies this app sets carry `Secure`. Must equal the API's value: the two set different cookies on one origin, and a disagreement makes sign-in loop. Setting it false is a downgrade, supported only when `QCMS_ADMIN_BASE_URL` is a loopback origin such as `http://localhost:7040`: at any other origin this app **refuses to start**, naming this variable (issue #292).",
  },
  {
    name: "QCMS_ADMIN_2FA",
    process: "admin",
    requirement: "optional",
    fallback: "required",
    description: "Must match the API's value; it decides whether enrollment can be skipped.",
  },
  {
    name: "QCMS_ADMIN_TRUSTED_PROXY_HOPS",
    process: "admin",
    requirement: "optional",
    fallback: "1",
    description:
      "How many proxies you run between the internet and this app. The address better-auth's per-IP sign-in throttle (SEC-1) keys on is the entry that many places from the **right** of the inbound `X-Forwarded-For`, so entries a client wrote itself are never reached. `1` is correct for both recipes in `docs/deploy-ingress.md`, which front this app exactly as they front the portal. **Setting it higher than the number of proxies that actually exist makes sign-in throttling bypassable** (the resolver reads into client-supplied text, and an attacker rotating the header gets a fresh backoff allowance every attempt); setting it lower is safe but coarse (admins get bucketed by a proxy's egress address); `0` trusts no forwarded header and puts every sign-in attempt in one shared bucket. Separate from `QCMS_PORTAL_TRUSTED_PROXY_HOPS` because the two apps are two hostnames and may sit behind different ingresses - set both, and set them to the same value unless one of them has an extra proxy in front of it. A non-numeric or out-of-range value is refused rather than defaulted.",
  },
  {
    name: "QCMS_ADMIN_SESSION_MAX_AGE_MS",
    process: "admin",
    requirement: "optional",
    fallback: "43200000 (12h)",
    description: "Must match the API's value; used for the app's own session bookkeeping.",
  },
  {
    name: "NODE_ENV",
    process: "admin",
    requirement: "optional",
    fallback: "production (set by the image)",
    description: "Decides the default for `QCMS_ADMIN_SECURE_COOKIES` when that is unset.",
  },

  // --- Compose-level (read by the Compose files, not by an app) --------------
  {
    name: "QCMS_DB_PASSWORD",
    process: "compose",
    requirement: "required",
    fallback: "",
    secret: true,
    description: "Postgres superuser password. Compose refuses to start without it.",
  },
  {
    name: "QCMS_DB_NAME",
    process: "compose",
    requirement: "optional",
    fallback: "qcms",
    description: "Database name created on first boot of the Postgres volume.",
  },
  {
    name: "QCMS_DB_USER",
    process: "compose",
    requirement: "optional",
    fallback: "qcms",
    description: "Database role created on first boot of the Postgres volume.",
  },
  {
    name: "QCMS_POSTGRES_IMAGE",
    process: "compose",
    requirement: "optional",
    fallback: "postgres:16-alpine",
    description:
      "Postgres image. Override it to pull from a mirror rather than Docker Hub; CI does exactly this.",
  },
  {
    name: "QCMS_PORTAL_PORT",
    process: "compose",
    requirement: "optional",
    fallback: "7000",
    description:
      "Host port the portal is published on. Comes from the stable block in `docs/PORTS.md` (R8); move it to run beside a dev server on the same seat.",
  },
  {
    name: "QCMS_ADMIN_PORT",
    process: "compose",
    requirement: "optional",
    fallback: "7040",
    description: "Host port the admin app is published on. Same allocation rules as the portal.",
  },
  {
    name: "QCMS_BIND_ADDRESS",
    process: "compose",
    requirement: "optional",
    fallback: "127.0.0.1",
    description:
      "Interface the two published apps bind to. The loopback default is a control: a bare publish would listen on every interface, ahead of the host firewall. Widen it only when a separate ingress host must reach these containers.",
  },
  {
    name: "QCMS_IMAGE_VERSION",
    process: "compose",
    requirement: "optional",
    fallback: "dev",
    description:
      "Version stamped into the images at build time (`org.opencontainers.image.version`). `pnpm qcms:build-images` derives a real one; a bare `docker compose build` leaves it `dev`.",
  },
  {
    name: "QCMS_CADDY_IMAGE",
    process: "compose",
    requirement: "optional",
    fallback: "caddy:2-alpine",
    description: "Ingress image, used only by the `docker-compose.proxy.yml` overlay.",
  },
  {
    name: "QCMS_PORTAL_DOMAIN",
    process: "compose",
    requirement: "conditional",
    fallback: "",
    description:
      "Public hostname Caddy serves the portal on. Required by the proxy overlay; unused without it.",
  },
  {
    name: "QCMS_ADMIN_DOMAIN",
    process: "compose",
    requirement: "conditional",
    fallback: "",
    description:
      "Public hostname Caddy serves the admin app on. Required by the proxy overlay; unused without it.",
  },
  {
    name: "QCMS_ACME_EMAIL",
    process: "compose",
    requirement: "conditional",
    fallback: "",
    description:
      "Contact address for the Let's Encrypt account. Required by the proxy overlay; unused without it.",
  },
];

/** Human-readable group headings, in render order. */
const GROUPS = [
  {
    process: "api",
    title: "API (`qcms-api`)",
    blurb:
      "Validated at boot by `apps/api/src/config.ts`, which collects every problem and fails fast naming the variables, never the values (SEC-8).",
  },
  {
    process: "portal",
    title: "Portal BFF (`qcms-portal`)",
    blurb:
      "Read on the server only. The portal holds no database credential and reaches the API over the internal network.",
  },
  {
    process: "admin",
    title: "Admin BFF (`qcms-admin`)",
    blurb:
      "Read on the server only. Since task 056 the admin holds no database credential either (ADR-35).",
  },
  {
    process: "compose",
    title: "Compose-level (`docker-compose.yml`, `docker-compose.proxy.yml`)",
    blurb:
      "Consumed by the Compose files themselves to build the topology; the containers never see them under these names.",
  },
];

// --- source scanning --------------------------------------------------------

/** Strip block and line comments, so a variable NAMED in prose is not counted as read. */
function stripComments(source) {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^[ \t]*\/\/.*$/gm, "");
}

/** `env.NAME` / `process.env.NAME` / `env["NAME"]` - a genuine read. */
const DIRECT_READ = /\b(?:process\.)?env(?:\.([A-Z][A-Z0-9_]*)|\[\s*"([A-Z][A-Z0-9_]*)"\s*\])/g;

/** A variable name passed as a string literal, which is how the API's parsers take it. */
const NAME_LITERAL = /"((?:QCMS|TURNSTILE|OTEL)_[A-Z0-9_]*[A-Z0-9]|DATABASE_URL)"/g;

/** `${VAR}` in a Compose file. The `(?<!\$)` skips `$${VAR}`, which is container-side. */
const COMPOSE_INTERPOLATION = /(?<!\$)\$\{([A-Z_][A-Z0-9_]*)/g;

/** `parseRateClass(env, "PREFIX", ...)` - one call, two real variables. */
const RATE_CLASS_CALL = /\bparseRateClass\(\s*env,\s*"([A-Z][A-Z0-9_]*)"/g;

/** The suffixes `parseRateClass` appends, read from its own body rather than assumed. */
const RATE_CLASS_SUFFIX = /`\$\{prefix\}(_[A-Z][A-Z0-9_]*)`/g;

/** A parser call naming its variable: `parseX(env, "NAME"`. */
const HELPER_CALL = /\b(parse[A-Za-z_]+)\(\s*\n?\s*env,\s*\n?\s*"([A-Z][A-Z0-9_]*)"/g;

const API_CONFIG = "apps/api/src/config.ts";

/**
 * Tracked, non-test source files under `roots`.
 *
 * @param {readonly string[]} roots repo-relative directories.
 * @returns {string[]}
 */
function sourceFiles(roots) {
  const listed = execFileSync("git", ["ls-files", "-z", ...roots], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  });
  return listed
    .split("\0")
    .filter((path) => path !== "" && /\.(ts|tsx)$/.test(path) && !NOT_PRODUCTION_SOURCE.test(path));
}

/** The suffixes a rate-limit class expands into, derived from `config.ts`. */
export function rateClassSuffixes() {
  const source = readFileSync(join(REPOSITORY_ROOT, API_CONFIG), "utf8");
  const suffixes = [...source.matchAll(RATE_CLASS_SUFFIX)].map((match) => match[1]);
  if (suffixes.length === 0) {
    throw new Error(
      `${API_CONFIG}: found no \`\${prefix}_SUFFIX\` template in parseRateClass. The rate-limit variables cannot be derived; update scripts/env-reference.mjs.`,
    );
  }
  return [...new Set(suffixes)];
}

/**
 * Every environment variable `processName` actually reads, from its source.
 *
 * @param {"api" | "portal" | "admin" | "compose"} processName
 * @returns {Set<string>}
 */
export function scanEnvNames(processName) {
  const found = new Set();
  if (processName === "compose") {
    for (const file of COMPOSE_FILES) {
      const text = readFileSync(join(REPOSITORY_ROOT, file), "utf8").replaceAll(/^\s*#.*$/gm, "");
      for (const match of text.matchAll(COMPOSE_INTERPOLATION)) found.add(match[1]);
    }
    return found;
  }

  const suffixes = processName === "api" ? rateClassSuffixes() : [];
  const rateClassPrefixes = new Set();
  for (const file of sourceFiles(SOURCE_ROOTS[processName])) {
    const text = stripComments(readFileSync(join(REPOSITORY_ROOT, file), "utf8"));
    for (const match of text.matchAll(DIRECT_READ)) found.add(match[1] ?? match[2]);
    for (const match of text.matchAll(NAME_LITERAL)) found.add(match[1]);
    for (const match of text.matchAll(RATE_CLASS_CALL)) rateClassPrefixes.add(match[1]);
  }
  // A rate-class prefix is not itself a variable: it names a pair.
  for (const prefix of rateClassPrefixes) {
    found.delete(prefix);
    for (const suffix of suffixes) found.add(`${prefix}${suffix}`);
  }
  return found;
}

/** The unconditional assembly path: every variable here is read on every boot. */
const UNCONDITIONAL_ENTRY = "export function loadConfig(env: Env): Config {";

/**
 * The body of the function whose signature line is `signature`, by brace matching.
 *
 * @param {string} source
 * @param {string} signature
 * @returns {string}
 */
function functionBody(source, signature) {
  const start = source.indexOf(signature);
  if (start === -1) {
    throw new Error(
      `env-reference: ${API_CONFIG} no longer contains "${signature}". The requirement scan is bounded to that function's body; re-point it before trusting its output.`,
    );
  }
  let depth = 0;
  for (let i = start + signature.length - 1; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`env-reference: unbalanced braces after "${signature}" in ${API_CONFIG}.`);
}

/**
 * Requirement as the API's own parsers imply it: variable name to
 * `"required" | "optional"`, for every variable read through a helper in
 * {@link REQUIREMENT_BY_HELPER}. Variables read some other way are absent.
 *
 * **Bounded to `loadConfig`'s own body, and that bound is the whole subtlety.**
 * A helper name states how strictly a value is validated *if the parse is reached*,
 * not whether an operator must set it. `parseAdminAuth` calls `parseRequiredString`
 * for `QCMS_ADMIN_AUTH_SECRET`, but `loadConfig` only calls `parseAdminAuth` when
 * `mount.admin` is on (`adminAuth: mount.admin ? parseAdminAuth(...) : ...`), so the
 * variable is *conditional*, not required, and reading the helper name alone would
 * classify it wrongly. Calls sitting directly in `loadConfig` have no such guard
 * above them, so there the helper does imply the requirement.
 *
 * Conditional variables are therefore absent from this map by construction, and the
 * table's `"conditional"` rows are prose the scan deliberately does not second-guess.
 *
 * @returns {Map<string, string>}
 */
export function apiRequirementFromParsers() {
  const source = functionBody(
    stripComments(readFileSync(join(REPOSITORY_ROOT, API_CONFIG), "utf8")),
    UNCONDITIONAL_ENTRY,
  );
  const suffixes = rateClassSuffixes();
  /** @type {Map<string, string>} */
  const classified = new Map();
  for (const [, helper, name] of source.matchAll(HELPER_CALL)) {
    const requirement = REQUIREMENT_BY_HELPER[helper];
    if (requirement === undefined) continue;
    if (helper === "parseRateClass") {
      for (const suffix of suffixes) classified.set(`${name}${suffix}`, requirement);
    } else {
      classified.set(name, requirement);
    }
  }
  return classified;
}

// --- rendering --------------------------------------------------------------

/** Markdown-table cell text for one row's requirement. */
function requirementCell(entry) {
  if (entry.requirement === "required") return "**required**";
  if (entry.requirement === "conditional") return "conditional";
  return "optional";
}

/** @param {EnvVar} entry */
function defaultCell(entry) {
  if (entry.requirement !== "optional") return "-";
  return entry.fallback === "" ? "(none)" : `\`${entry.fallback}\``;
}

/** The generated block, marker to marker. */
export function renderEnvReference() {
  const lines = [BEGIN_MARKER, ""];
  for (const group of GROUPS) {
    const rows = ENV_REFERENCE.filter((entry) => entry.process === group.process);
    lines.push(`#### ${group.title}`, "", group.blurb, "");
    lines.push("| Variable | Required | Default | Meaning |");
    lines.push("| --- | --- | --- | --- |");
    for (const entry of rows) {
      const name = entry.secret === true ? `\`${entry.name}\` (secret)` : `\`${entry.name}\``;
      lines.push(
        `| ${name} | ${requirementCell(entry)} | ${defaultCell(entry)} | ${entry.description} |`,
      );
    }
    lines.push("");
  }
  lines.push(END_MARKER);
  return lines.join("\n");
}

/**
 * Replace the generated block in `text`, throwing when the markers are missing.
 *
 * @param {string} text
 * @returns {string}
 */
export function replaceBlock(text) {
  const begin = text.indexOf(BEGIN_MARKER);
  const end = text.indexOf(END_MARKER);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `${OPERATIONS_DOC} is missing the env-reference markers. Expected:\n${BEGIN_MARKER}\n...\n${END_MARKER}`,
    );
  }
  return text.slice(0, begin) + renderEnvReference() + text.slice(end + END_MARKER.length);
}

/** The block currently sitting in the document. */
export function currentBlock() {
  const text = readFileSync(join(REPOSITORY_ROOT, OPERATIONS_DOC), "utf8");
  const begin = text.indexOf(BEGIN_MARKER);
  const end = text.indexOf(END_MARKER);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`${OPERATIONS_DOC} is missing the env-reference markers.`);
  }
  return text.slice(begin, end + END_MARKER.length);
}

export function main() {
  if (argv.includes("--write")) {
    const path = join(REPOSITORY_ROOT, OPERATIONS_DOC);
    writeFileSync(path, replaceBlock(readFileSync(path, "utf8")));
    process.stdout.write(`env-reference: rewrote the generated block in ${OPERATIONS_DOC}\n`);
    return 0;
  }
  process.stdout.write(`${renderEnvReference()}\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(argv[1] ?? "").href) {
  process.exitCode = main();
}
// `fileURLToPath` is imported for the JSDoc-typed path helpers above to stay
// consistent with the other scripts; referenced here so the import is not dead.
void fileURLToPath;
