#!/usr/bin/env node
// @ts-check
/**
 * The operator environment reference, generated here and asserted against the source in
 * `env-reference.test.ts`: names read, requirement implied by the parser helper, and the rendered
 * `docs/operations.md` block. Descriptions and defaults are not derived.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { REPOSITORY_ROOT } from "./docker.mjs";

export const OPERATIONS_DOC = "docs/operations.md";

export const BEGIN_MARKER =
  "<!-- BEGIN GENERATED: env-reference (node scripts/env-reference.mjs --write) -->";
export const END_MARKER = "<!-- END GENERATED: env-reference -->";

/**
 * The dev and dev-tools overlays are deliberately absent: their variables are a
 * developer's, never an operator's, so a row here would document a stack the reader
 * of `docs/operations.md` does not have.
 */
const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.proxy.yml"];

/** Directories, never a file list: a new module reading `process.env` must not slip past. */
const SOURCE_ROOTS = {
  api: ["apps/api/src"],
  portal: ["apps/portal"],
  admin: ["apps/admin"],
};

const NOT_PRODUCTION_SOURCE = /(\.test\.|\.spec\.|\.pw\.|\/e2e\/|\/__|test-support)/;

/**
 * The helper name IS the validation contract: a `parseRequired*` records an issue when
 * the variable is absent, a `parse*` with a fallback cannot. A variable read outside
 * these helpers stays unclassified and only its name is checked.
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
 * @property {boolean} [secret] true when the value is key material.
 * @property {string} description
 */

/**
 * @type {readonly EnvVar[]}
 */
export const ENV_REFERENCE = [
  {
    name: "DATABASE_URL",
    process: "api",
    requirement: "required",
    fallback: "",
    secret: true,
    description:
      "Postgres connection string held only by the API. Compose builds it from `QCMS_DB_*` values.",
  },
  {
    name: "QCMS_MOUNT",
    process: "api",
    requirement: "required",
    fallback: "",
    description:
      "Comma-separated route groups: `public`, `internal`, `admin`, non-prod names from `QCMS_ENVIRONMENTS`, or `all`. `public` serves unprefixed prod; environment names serve `/<env>`; `prod` itself is refused. `all` mounts every group and configured environment. Unmounted routes return 404. Outbox delivery and retention run where `internal` is mounted.",
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
      "BFF service tokens, at least 32 characters each. Any listed token is accepted; retain both during a two-deploy rotation.",
  },
  {
    name: "QCMS_APP_KEY",
    process: "api",
    requirement: "required",
    fallback: "",
    secret: true,
    description:
      "AES-256-GCM key, at least 32 characters, for stored webhook HMAC secrets. Set once and back up: no in-place rotation exists, and replacement makes deliveries dead-letter. Recover by reissuing each webhook secret, coordinating consumers and redelivering. Two-factor keys use `QCMS_ADMIN_AUTH_SECRET`. See the App encryption key runbook in `docs/operations.md`.",
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
      "better-auth signing and encryption secret, at least 32 characters; required when `admin` is mounted. Back up with the database: replacing it makes stored TOTP secrets and recovery codes unreadable. Rotate through `QCMS_ADMIN_AUTH_SECRETS`; see Admin auth secret rotation in `docs/operations.md`.",
  },
  {
    name: "QCMS_ADMIN_AUTH_SECRETS",
    process: "api",
    requirement: "optional",
    fallback: "unset - version 1 holds QCMS_ADMIN_AUTH_SECRET",
    secret: true,
    description:
      "Comma-separated `<version>:<secret>` keys, strictly descending, newest first, for example `2:<new>,1:<old>`. Each needs at least 32 characters. The first encrypts new material; retain older keys to read existing factors. Leave unset unless rotating. See Admin auth secret rotation in `docs/operations.md`.",
  },
  {
    name: "QCMS_ADMIN_BASE_URL",
    process: "api",
    requirement: "conditional",
    fallback: "",
    description:
      "Browser-facing admin origin, required when `admin` is mounted. Must exactly match the origin seen by the browser and configured in the admin service; better-auth scopes cookies and trusted origins to it.",
  },
  {
    name: "QCMS_TURNSTILE_SITE_KEY",
    process: "api",
    requirement: "conditional",
    fallback: "",
    description:
      "Public Turnstile site key, required when `QCMS_FLAG_CHALLENGE_PROVIDER=turnstile`, ignored otherwise. Set the same value on API and portal.",
  },
  {
    name: "TURNSTILE_SITE_KEY",
    process: "api",
    requirement: "optional",
    fallback: "",
    description:
      "Deprecated fallback for `QCMS_TURNSTILE_SITE_KEY`; setting it produces a boot warning. The prefixed name wins when both are set. Migrate to the prefixed name and remove this one.",
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
      "Sets the default for `QCMS_ADMIN_SECURE_COOKIES`; keep the production Dockerfile value in deployment. Sign-in throttling is independently controlled by `QCMS_ADMIN_SIGNIN_THROTTLE` in every environment.",
  },
  {
    name: "QCMS_FLAG_CHALLENGE_PROVIDER",
    process: "api",
    requirement: "optional",
    fallback: "none",
    description:
      "Challenge provider: `none` or `turnstile`. Unknown `QCMS_FLAG_*` names refuse boot.",
  },
  {
    name: "QCMS_ADMIN_2FA",
    process: "api",
    requirement: "optional",
    fallback: "required",
    description:
      "TOTP policy: `required` for production; `optional` skips enrollment for development only.",
  },
  {
    name: "QCMS_ADMIN_SECURE_COOKIES",
    process: "api",
    requirement: "optional",
    fallback: "true when NODE_ENV=production",
    description:
      "Secure-cookie policy for the browser-facing admin origin. Match the admin service or different cookie families can cause sign-in loops. The admin refuses false on non-loopback origins; use TLS or a loopback tunnel.",
  },
  {
    name: "QCMS_ADMIN_TRUSTED_PROXY_HOPS",
    process: "api",
    requirement: "optional",
    fallback: "unset",
    description:
      "Declares whether admin ingress has a proxy; the admin service resolves addresses. Unset or 0 warns that all callers share one throttle bucket: three attempts can block everyone for ten seconds. Set the same actual hop count in both services only after installing the proxy; declaring one here alone does not resolve addresses.",
  },
  {
    name: "QCMS_ADMIN_PASSWORD_BREACH_CHECK",
    process: "api",
    requirement: "optional",
    fallback: "true",
    description:
      "Checks passwords through `api.pwnedpasswords.com/range/{prefix}`, sending only five SHA-1 hex characters. Unreachable service refuses passwords, including first-admin creation. Disable only for offline operation or emergency rotation during an outage; API and CLI startup warn of the security downgrade.",
  },
  {
    name: "QCMS_ADMIN_SIGNIN_THROTTLE",
    process: "api",
    requirement: "optional",
    fallback: "true",
    description:
      "Enabled in every environment: three attempts per client address per ten seconds across `/sign-in`, `/sign-up`, `/change-password`, `/change-email` and `/two-factor/*`; further attempts return 429. False permits unlimited attempts and logs a startup warning. Use that escape hatch only for local development. See the sign-in throttling runbook in `docs/operations.md`.",
  },
  {
    name: "QCMS_ADMIN_SESSION_IDLE_MS",
    process: "api",
    requirement: "optional",
    fallback: "3600000 (1h)",
    description: "Idle window before an administrator session expires.",
  },
  {
    name: "QCMS_ADMIN_SESSION_MAX_AGE_MS",
    process: "api",
    requirement: "optional",
    fallback: "43200000 (12h)",
    description:
      "Absolute administrator lifetime from session issue. Beyond it every admin call returns 401 regardless of activity.",
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
      "SSRF override. False requires HTTPS and rejects private, reserved, loopback and link-local targets. Enable only for an on-prem deployment that legitimately delivers to internal systems.",
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
      "Retention from each delivery attempt for the stored consumer-response prefix, which may echo answers. Other attempt fields remain. 0 removes it at the next sweep. An environment row overrides this with `delivery_snippet_ttl_ms`; configure through `pnpm qcms:environment create --delivery-snippet-ttl-ms`.",
  },
  {
    name: "QCMS_OUTBOX_PAYLOAD_TTL_MS",
    process: "api",
    requirement: "optional",
    fallback: "2592000000 (30d)",
    description:
      "Retention from settlement of an event and its full fan-out for the answer-bearing payload used in redelivery. The envelope and delivery records remain; 0 removes the payload on settlement. An environment row overrides this with `outbox_payload_ttl_ms`; configure through `pnpm qcms:environment create --outbox-payload-ttl-ms`.",
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
      "Maximum accepted request body. Keep the ingress ceiling aligned; both ingress recipes configure one.",
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
      "Session starts per vouched client address per window. The portal resolves `X-Forwarded-For` using `QCMS_PORTAL_TRUSTED_PROXY_HOPS`. Without ingress or its forwarded header, everyone shares `unknown-ip`: the default becomes 20 starts per hour deployment-wide. Configure ingress with `docs/deploy-ingress.md`, or raise this for expected peak traffic.",
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
      "Answer entries per session per window, about 2/s sustained. A batch spends one unit per entry; its allowance is at least the step bound so every valid step fits. A larger configured allowance remains in force.",
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
    name: "QCMS_RL_ROSTER_SESSION_WINDOW_MS",
    process: "api",
    requirement: "optional",
    fallback: "5000",
    description:
      "Session-keyed window for repeating-group Add/Remove at `POST /sessions/{id}/roster`. This separately limits operation frequency; the authored group `max` bounds size.",
  },
  {
    name: "QCMS_RL_ROSTER_SESSION_MAX",
    process: "api",
    requirement: "optional",
    fallback: "10",
    description:
      "Roster operations per session per window. Sized for repeated Add presses while completing a multi-instance form.",
  },
  {
    name: "QCMS_RL_ROSTER_IP_WINDOW_MS",
    process: "api",
    requirement: "optional",
    fallback: "60000",
    description:
      "Rate-limit window for `POST /sessions/{id}/roster`, keyed by the vouched client address.",
  },
  {
    name: "QCMS_RL_ROSTER_IP_MAX",
    process: "api",
    requirement: "optional",
    fallback: "300",
    description:
      "Roster operations that may be made per window across every session sharing one client address, caveated exactly as `QCMS_RL_ANSWERS_IP_MAX`.",
  },
  {
    name: "QCMS_FLAG_AGENT_AUTHORING",
    process: "api",
    requirement: "optional",
    fallback: "none",
    description:
      "Provider: `none`, `anthropic`, `openai`, `google`, `openai-compatible`, or deterministic test provider `fake`. `none` leaves assist routes unmounted (404) and hides the panel. Match the admin setting. Setup: `docs/agent-authoring.md`.",
  },
  {
    name: "QCMS_AGENT_MODEL",
    process: "api",
    requirement: "conditional",
    fallback: "",
    description:
      "The model provider's own model id, never interpreted here. Required when `QCMS_FLAG_AGENT_AUTHORING` names a real provider, ignored otherwise.",
  },
  {
    name: "QCMS_AGENT_API_KEY",
    process: "api",
    requirement: "conditional",
    fallback: "",
    secret: true,
    description:
      "Required for real model providers except local endpoints: loopback, private IP ranges, `host.docker.internal`, or `.local`, `.localhost` and `.internal` hosts. Never logged or echoed in boot errors.",
  },
  {
    name: "QCMS_AGENT_BASE_URL",
    process: "api",
    requirement: "conditional",
    fallback: "",
    description:
      "Model endpoint override; required for `openai-compatible`, including Ollama, vLLM, LM Studio and llama.cpp-server. Hosted providers may use it for a gateway or proxy.",
  },
  {
    name: "QCMS_AGENT_MAX_STEPS",
    process: "api",
    requirement: "optional",
    fallback: "8",
    description: "Maximum tool-loop steps per agent turn.",
  },
  {
    name: "QCMS_AGENT_THINKING",
    process: "api",
    requirement: "optional",
    fallback: "off",
    description:
      "`off` drops reasoning, including unsolicited parts; `summary` requests the provider summary for a collapsed Thinking disclosure. Text is never logged, stored, exported or replayed; only token counts are logged. Reasoning is billed output within the turn-step cap. API-only configuration; admin receives events, never this value.",
  },
  {
    name: "QCMS_RL_AGENT_ASSIST_WINDOW_MS",
    process: "api",
    requirement: "optional",
    fallback: "60000",
    description:
      "Rate-limit window for `POST /admin/forms/{id}/draft/assist`, keyed by admin principal.",
  },
  {
    name: "QCMS_RL_AGENT_ASSIST_MAX",
    process: "api",
    requirement: "optional",
    fallback: "10",
    description: "Agent turns one administrator may request per window.",
  },
  {
    name: "QCMS_SMTP_HOST",
    process: "api",
    requirement: "optional",
    fallback: "",
    description:
      "Outbound mail relay. Unset leaves mail unconfigured, which features that email a sign-in link read before acting. Mail is configured only where `admin` is mounted, since every link points at `QCMS_ADMIN_BASE_URL`. See Outbound email in `docs/DEVELOPER_GUIDE.md`.",
  },
  {
    name: "QCMS_SMTP_PORT",
    process: "api",
    requirement: "optional",
    fallback: "587, 465 for tls, 25 for none",
    description: "Relay port.",
  },
  {
    name: "QCMS_SMTP_SECURITY",
    process: "api",
    requirement: "optional",
    fallback: "starttls",
    description:
      "`starttls` requires the STARTTLS upgrade and refuses a relay that does not offer it; `tls` is implicit TLS. Certificates are always verified. `none` is plaintext and refused at boot unless `QCMS_SMTP_ALLOW_INSECURE=true`.",
  },
  {
    name: "QCMS_SMTP_ALLOW_INSECURE",
    process: "api",
    requirement: "optional",
    fallback: "false",
    description:
      "Development opt-in that admits `QCMS_SMTP_SECURITY=none` for a local relay such as Mailpit. Never set it in a deployment: links would cross the network unencrypted. Credentials are refused over plaintext even with it set.",
  },
  {
    name: "QCMS_SMTP_USER",
    process: "api",
    requirement: "conditional",
    fallback: "",
    description: "Relay user name; set together with `QCMS_SMTP_PASSWORD`, or neither.",
  },
  {
    name: "QCMS_SMTP_PASSWORD",
    process: "api",
    requirement: "conditional",
    fallback: "",
    secret: true,
    description:
      "Relay password; set together with `QCMS_SMTP_USER`. Never logged or echoed in boot errors; example-file placeholders refuse boot.",
  },
  {
    name: "QCMS_SMTP_FROM",
    process: "api",
    requirement: "conditional",
    fallback: "",
    description:
      "Sender, required when `QCMS_SMTP_HOST` is set: an address or `Name <address>` on one line.",
  },
  {
    name: "QCMS_SMTP_TIMEOUT_MS",
    process: "api",
    requirement: "optional",
    fallback: "10000",
    description:
      "Per-phase limit for the relay: connecting, waiting for the greeting, and socket inactivity. It does not cap total send time; a phase that exceeds it fails the send as undeliverable.",
  },
  {
    name: "OTEL_EXPORTER_OTLP_ENDPOINT",
    process: "api",
    requirement: "optional",
    fallback: "",
    description:
      "OTLP collector endpoint. Unset disables telemetry; set exports traces and allowlisted logs and adds `trace_id`/`span_id` to stdout records.",
  },
  {
    name: "OTEL_SERVICE_NAME",
    process: "api",
    requirement: "optional",
    fallback: "qcms-api",
    description:
      "Service name reported on exported traces and logs. Read only when telemetry is on.",
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
      "Bootstrap-only provisional password alongside `QCMS_ADMIN_EMAIL`. Pass through the command environment, never `.env` or CLI argv: use `docker compose exec --env QCMS_ADMIN_PASSWORD ...` without a value. First sign-in requires password replacement, then TOTP enrollment and recovery-code display; admin routes remain blocked until replacement.",
  },
  {
    name: "QCMS_ADMIN_NAME",
    process: "api",
    requirement: "optional",
    fallback: "the email local part",
    description: "Display name for the bootstrapped administrator.",
  },

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
      "BFF service token; must match an accepted API token. Example-file placeholders refuse boot without echoing the value.",
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
    name: "QCMS_PORTAL_ENVIRONMENTS",
    process: "portal",
    requirement: "optional",
    fallback: "",
    description:
      "Comma-separated non-prod environments served under `/<env>/`, for example `https://forms.example.com/test/l/<token>`. Prod is always unprefixed; listing it is ignored. Absent lists none, so other environment paths return 404. Names must match `^[a-z][a-z0-9]*$`; invalid names are ignored. Match the API `QCMS_MOUNT`.",
  },
  {
    name: "QCMS_PORTAL_ENVIRONMENT_HOSTS",
    process: "portal",
    requirement: "optional",
    fallback: "",
    description:
      "`<env>=<host>` pairs, for example `test=test-forms.example.com`. Listed hosts disable anonymous `/f/{slug}` access; they do not confine `/<env>/` paths to that hostname. Host and path restrictions work independently. Enforce network, VPN or identity access at ingress; see Restricting the test environment in `docs/deploy-ingress.md`.",
  },
  {
    name: "QCMS_PORTAL_TRUSTED_PROXY_HOPS",
    process: "portal",
    requirement: "optional",
    fallback: "1",
    description:
      "Actual trusted hops counted from the right of `X-Forwarded-For`; 1 fits both ingress recipes in `docs/deploy-ingress.md`. Too many trusts client text and bypasses limits; too few merges buckets at a proxy. 0 trusts no forwarded address and shares one bucket. Invalid counts refuse boot.",
  },
  {
    name: "QCMS_SECURE_COOKIES",
    process: "portal",
    requirement: "optional",
    fallback: "true when NODE_ENV=production",
    description:
      "Secure respondent cookies; leave unset behind TLS. False is allowed only on loopback such as `http://localhost:7000`; other origins refuse boot. Accepts trimmed, case-insensitive `true/1/yes/on` or `false/0/no/off`; invalid values refuse boot. Unset or blank uses `NODE_ENV`.",
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
      "Public site key for the Turnstile widget; required with that challenge provider. Match the API value. The API accepts deprecated `TURNSTILE_SITE_KEY` with a boot warning; use this prefixed name.",
  },
  {
    name: "QCMS_LOCALE",
    process: "portal",
    requirement: "optional",
    fallback: "en-GB",
    description:
      "BCP 47 formatting tag, for example `en-GB`, `en-US` or `de-DE`; copy stays English. Controls scripted and scriptless date order, dates, times, numbers and lists. Match admin for preview fidelity. Blank defaults to `en-GB`; invalid tags or unavailable `Intl` data refuse boot without echoing the value.",
  },
  {
    name: "QCMS_PORTAL_THEME",
    process: "portal",
    requirement: "optional",
    fallback: "slate",
    description: "Respondent theme; unknown values fall back to the default.",
  },
  {
    name: "QCMS_PORTAL_MODE",
    process: "portal",
    requirement: "optional",
    fallback: "auto",
    description: "Default mode: `light`, `dark`, `auto` or `hc` (high contrast).",
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
    fallback: "the @roonga/qcms-ui default density",
    description: "Spacing token group.",
  },
  {
    name: "QCMS_PORTAL_FONTS",
    process: "portal",
    requirement: "optional",
    fallback: "",
    description:
      "Offered font registry keys from `apps/portal/lib/server/theme.ts`, separated by commas or spaces. Blank offers all; unknown keys are ignored and system is always offered.",
  },
  {
    name: "QCMS_PORTAL_FONT",
    process: "portal",
    requirement: "optional",
    fallback: "the system font stack",
    description: "Default font registry key. Unknown or excluded keys use the system stack.",
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
    description:
      "OTLP collector endpoint. Unset disables the SDK; set exports traces and allowlisted logs.",
  },
  {
    name: "OTEL_SERVICE_NAME",
    process: "portal",
    requirement: "optional",
    fallback: "qcms-portal",
    description: "Service name reported on exported traces and logs.",
  },

  {
    name: "QCMS_DEV_LOGIN_PREFILL",
    process: "admin",
    requirement: "optional",
    fallback: "disabled",
    description:
      "Only exact `true` enables password query-string prefill. The local `docker-compose.dev-tools.yml` credential link uses it; leave unset outside development. Email prefill needs no flag.",
  },
  {
    name: "QCMS_FLAG_AGENT_AUTHORING",
    process: "admin",
    requirement: "optional",
    fallback: "none",
    description:
      "Match the API provider setting to mount the panel and streaming proxy. Browser code receives enabled behavior; provider keys stay in the API.",
  },
  {
    name: "QCMS_API_BASE_URL",
    process: "admin",
    requirement: "required",
    fallback: "",
    description:
      "Internal API origin; the admin reaches all domain data through it and holds no database credential.",
  },
  {
    name: "QCMS_INTERNAL_TOKEN",
    process: "admin",
    requirement: "required",
    fallback: "",
    secret: true,
    description:
      "BFF service token; must match an accepted API token. Example-file placeholders refuse boot without echoing the value.",
  },
  {
    name: "QCMS_ADMIN_BASE_URL",
    process: "admin",
    requirement: "required",
    fallback: "",
    description:
      "Browser-facing admin origin for state-changing origin checks. Match the API configuration exactly.",
  },
  {
    name: "QCMS_ADMIN_SECURE_COOKIES",
    process: "admin",
    requirement: "optional",
    fallback: "true when NODE_ENV=production",
    description:
      "Match the API Secure-cookie policy or different cookie families can cause sign-in loops. False is allowed only on loopback such as `http://localhost:7040`; other origins refuse boot.",
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
      "Actual trusted hops counted from the right of `X-Forwarded-For` for sign-in throttling; 1 fits the ingress recipes. Too many trusts client text and bypasses throttling; too few merges proxy buckets. 0 shares one bucket. Invalid counts refuse boot. Match the portal count unless ingress differs; see `docs/deploy-ingress.md`.",
  },
  {
    name: "QCMS_ADMIN_SESSION_MAX_AGE_MS",
    process: "admin",
    requirement: "optional",
    fallback: "43200000 (12h)",
    description: "Must match the API's value; used for the app's own session bookkeeping.",
  },
  {
    name: "QCMS_PORTAL_BASE_URL",
    process: "admin",
    requirement: "optional",
    fallback: "",
    description:
      "Match the public portal origin used by API and portal, for example `${QCMS_PORTAL_BASE_URL}/f/<slug>`. The builder writes a shareable link and makes no portal request. Unset hides the link.",
  },
  {
    name: "QCMS_LOCALE",
    process: "admin",
    requirement: "optional",
    fallback: "en-GB",
    description:
      "BCP 47 formatting tag, for example `en-GB`, `en-US` or `de-DE`; copy stays English. Match portal for preview dates, field order, numbers and lists. Blank defaults to `en-GB`; invalid tags or unavailable `Intl` data refuse boot without echoing the value. Operator timestamps use the browser zone.",
  },
  {
    name: "QCMS_PORTAL_THEME",
    process: "admin",
    requirement: "optional",
    fallback: "slate",
    description:
      "Match the portal theme so previews show respondent appearance. Unknown values use the same fallback as portal; admin chrome keeps its own theme.",
  },
  {
    name: "NODE_ENV",
    process: "admin",
    requirement: "optional",
    fallback: "production (set by the image)",
    description: "Decides the default for `QCMS_ADMIN_SECURE_COOKIES` when that is unset.",
  },
  {
    name: "OTEL_EXPORTER_OTLP_ENDPOINT",
    process: "admin",
    requirement: "optional",
    fallback: "",
    description:
      "OTLP collector endpoint. Unset disables the SDK; set exports traces and allowlisted logs.",
  },
  {
    name: "OTEL_SERVICE_NAME",
    process: "admin",
    requirement: "optional",
    fallback: "qcms-admin",
    description: "Service name reported on exported traces and logs.",
  },

  {
    name: "QCMS_DB_PASSWORD",
    process: "compose",
    requirement: "required",
    fallback: "",
    secret: true,
    description:
      "Bootstrap superuser password, required by Compose. Only `db-roles` uses it to create migration, control and environment roles; traffic-serving processes must not hold it.",
  },
  {
    name: "QCMS_DB_MIGRATE_PASSWORD",
    process: "compose",
    requirement: "required",
    fallback: "",
    secret: true,
    description:
      "Schema-owner password for the one-shot `qcms_migrate` role, held only by the migration service. See Least-privilege database roles in `docs/operations.md`.",
  },
  {
    name: "QCMS_DB_APP_CONTROL_PASSWORD",
    process: "compose",
    requirement: "required",
    fallback: "",
    secret: true,
    description:
      "Control-pool password for `qcms_app_control`: control DML excluding break-glass audit, and INSERT-only environment outboxes. Use distinct application-role passwords. See Least-privilege database roles in `docs/operations.md`.",
  },
  {
    name: "QCMS_DB_APP_TEST_PASSWORD",
    process: "compose",
    requirement: "required",
    fallback: "",
    secret: true,
    description:
      "Test-pool password for `qcms_app_test`: DML only on `data_test` and named control reads. Use distinct application-role passwords. See Least-privilege database roles in `docs/operations.md`.",
  },
  {
    name: "QCMS_DB_APP_PROD_PASSWORD",
    process: "compose",
    requirement: "required",
    fallback: "",
    secret: true,
    description:
      "Prod-pool password for `qcms_app_prod`: DML only on `data_prod` and named control reads. Use distinct application-role passwords. See Least-privilege database roles in `docs/operations.md`.",
  },
  {
    name: "QCMS_ENVIRONMENTS",
    process: "api",
    requirement: "optional",
    fallback: "test,prod",
    description:
      "Comma-separated live environments, including `prod`. Each needs `QCMS_DATABASE_URL_<ENV>`; the API refuses boot unless the set exactly matches `control.environments`. Requests without an environment use prod. Admin `x-qcms-environment` selections must belong to this set or return 400.",
  },
  {
    name: "QCMS_DATABASE_URL_TEST",
    process: "api",
    requirement: "required",
    fallback: "",
    secret: true,
    description:
      "Test pool credential for `qcms_app_test`. Add one upper-cased `QCMS_DATABASE_URL_<ENV>` per configured environment. Credentials come from configuration, never from database rows.",
  },
  {
    name: "QCMS_DATABASE_URL_PROD",
    process: "api",
    requirement: "required",
    fallback: "",
    secret: true,
    description:
      "Prod pool credential for `qcms_app_prod`; follows the `QCMS_DATABASE_URL_<ENV>` naming rule.",
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
    description:
      "Bootstrap superuser created with the Postgres volume; used only to create least-privilege roles.",
  },
  {
    name: "QCMS_POSTGRES_IMAGE",
    process: "compose",
    requirement: "optional",
    fallback: "postgres:16-alpine",
    description: "Postgres image; override to use an image mirror instead of Docker Hub.",
  },
  {
    name: "QCMS_PORTAL_PORT",
    process: "compose",
    requirement: "optional",
    fallback: "7000",
    description:
      "Published portal host port from `docs/PORTS.md`; choose another allocated slot when running beside a dev server.",
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
    name: "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
    process: "compose",
    requirement: "optional",
    fallback: "unset - Next generates a fresh key for every build",
    secret: true,
    description:
      "Portal-image build secret passed to `docker/portal.Dockerfile`: 32 bytes base64. Pinning preserves action ids across deploys, avoiding 409 and loss of unsaved values on held scriptless Add/Remove requests. Keys are readable in image manifests; pinning shares that exposure across builds. Published `ghcr.io/roonga/qcms-portal` images have no shared key. See `docs/deploy-ingress.md`.",
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

/**
 * Replace every comment with blank space so a variable NAMED in prose is not counted as a read. A
 * state machine, because regexes cannot tell a comment opener inside a string, and failing open would
 * silently shrink the corpus. Regex literals are not tracked; one containing `/*` or `//` is the residue.
 *
 * @param {string} source
 * @returns {string}
 */
export function stripComments(source) {
  const out = [];
  /**
   * One entry per open template literal: the brace depth its innermost `${` opened
   * at, or `null` while the scan is in the template's text.
   *
   * @type {(number | null)[]}
   */
  const templates = [];
  let braceDepth = 0;
  let index = 0;

  const inTemplateText = () => templates.length > 0 && templates.at(-1) === null;

  while (index < source.length) {
    const character = source[index];

    if (inTemplateText()) {
      if (character === "\\") {
        out.push(source.slice(index, index + 2));
        index += 2;
        continue;
      }
      if (character === "`") {
        templates.pop();
        out.push(character);
        index += 1;
        continue;
      }
      if (character === "$" && source[index + 1] === "{") {
        braceDepth += 1;
        templates[templates.length - 1] = braceDepth;
        out.push("${");
        index += 2;
        continue;
      }
      out.push(character);
      index += 1;
      continue;
    }

    if (character === "/" && source[index + 1] === "/") {
      let end = index + 2;
      while (end < source.length && source[end] !== "\n") end += 1;
      index = end;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) {
        throw new Error(
          "env-reference: unterminated block comment. The scanner refuses to swallow the rest of the file, which is how issue #773 lost four reads silently.",
        );
      }
      const removed = source.slice(index, end + 2);
      out.push("\n".repeat(removed.split("\n").length - 1));
      index = end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const closed = endOfQuotedString(source, index, character);
      if (closed === undefined) {
        // An apostrophe in JSX text, not a string. Ordinary character.
        out.push(character);
        index += 1;
        continue;
      }
      out.push(source.slice(index, closed + 1));
      index = closed + 1;
      continue;
    }
    if (character === "`") {
      templates.push(null);
      out.push(character);
      index += 1;
      continue;
    }
    if (character === "{") {
      braceDepth += 1;
    } else if (character === "}") {
      if (templates.length > 0 && templates.at(-1) === braceDepth) {
        templates[templates.length - 1] = null;
      }
      braceDepth -= 1;
    }
    out.push(character);
    index += 1;
  }

  return out.join("");
}

/**
 * @param {string} source
 * @param {number} start
 * @param {string} quote
 * @returns {number | undefined}
 */
function endOfQuotedString(source, start, quote) {
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "\n") return undefined;
    if (character === quote) return index;
  }
  return undefined;
}

const DIRECT_READ = /\b(?:process\.)?env(?:\.([A-Z][A-Z0-9_]*)|\[\s*"([A-Z][A-Z0-9_]*)"\s*\])/g;

const NAME_LITERAL = /"((?:QCMS|TURNSTILE|OTEL)_[A-Z0-9_]*[A-Z0-9]|DATABASE_URL)"/g;

/** `${VAR}` in a Compose file. The `(?<!\$)` skips `$${VAR}`, which is container-side. */
const COMPOSE_INTERPOLATION = /(?<!\$)\$\{([A-Z_][A-Z0-9_]*)/g;

/** `parseRateClass(env, "PREFIX", ...)` - one call, two real variables. */
const RATE_CLASS_CALL = /\bparseRateClass\(\s*env,\s*"([A-Z][A-Z0-9_]*)"/g;

/** The suffixes `parseRateClass` appends, read from its own body rather than assumed. */
const RATE_CLASS_SUFFIX = /`\$\{prefix\}(_[A-Z][A-Z0-9_]*)`/g;

const HELPER_CALL = /\b(parse[A-Za-z_]+)\(\s*\n?\s*env,\s*\n?\s*"([A-Z][A-Z0-9_]*)"/g;

/** A call site that names no variable, because the name is computed (ADR-40, Q2). */
const ENVIRONMENT_URL_CALL = /\benvironmentDatabaseUrlVariable\(/;

/** The prefix that helper interpolates the environment into, read from its own body. */
const ENVIRONMENT_URL_PREFIX = /return `([A-Z][A-Z0-9_]*_)\$\{environment\.toUpperCase\(\)\}`/;

const DEFAULT_ENVIRONMENT_SET = /env\.QCMS_ENVIRONMENTS \?\? "([a-z0-9,]+)"/;

const API_CONFIG = "apps/api/src/config.ts";

const ENVIRONMENT_NAMING = "packages/db/src/environment/naming.ts";

/**
 * @param {readonly string[]} roots
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
 * Both the prefix and the environment names are derived from the source, never typed
 * here, so the table documents exactly the set a deployment that configures nothing
 * gets. A set chosen at deploy time cannot be enumerated (ADR-40, Q2).
 */
export function environmentDatabaseUrlVariables() {
  const naming = readFileSync(join(REPOSITORY_ROOT, ENVIRONMENT_NAMING), "utf8");
  const prefix = ENVIRONMENT_URL_PREFIX.exec(naming)?.[1];
  if (prefix === undefined) {
    throw new Error(
      `${ENVIRONMENT_NAMING}: found no \`QCMS_..._\${environment.toUpperCase()}\` template. The per-environment connection-string variables cannot be derived; update scripts/env-reference.mjs.`,
    );
  }
  const config = readFileSync(join(REPOSITORY_ROOT, API_CONFIG), "utf8");
  const fallback = DEFAULT_ENVIRONMENT_SET.exec(config)?.[1];
  if (fallback === undefined) {
    throw new Error(
      `${API_CONFIG}: found no \`QCMS_ENVIRONMENTS ?? "..."\` fallback. The default environment set cannot be derived; update scripts/env-reference.mjs.`,
    );
  }
  return fallback
    .split(",")
    .filter((name) => name !== "")
    .map((name) => `${prefix}${name.toUpperCase()}`);
}

/**
 * @param {string} text
 * @returns {{ names: Set<string>; rateClassPrefixes: Set<string>; readsEnvironmentUrls: boolean }}
 */
export function scanSourceText(text) {
  const stripped = stripComments(text);
  const names = new Set();
  const rateClassPrefixes = new Set();
  for (const match of stripped.matchAll(DIRECT_READ)) names.add(match[1] ?? match[2]);
  for (const match of stripped.matchAll(NAME_LITERAL)) names.add(match[1]);
  for (const match of stripped.matchAll(RATE_CLASS_CALL)) rateClassPrefixes.add(match[1]);
  return {
    names,
    rateClassPrefixes,
    readsEnvironmentUrls: ENVIRONMENT_URL_CALL.test(stripped),
  };
}

/**
 * Read by the source but NOT an operator's to set, so no row is forced. The bar for
 * an addition: set by the framework or platform, read for a compile-time or runtime
 * branch, and harmful rather than useful to set.
 */
const FRAMEWORK_PROVIDED = new Set(["NEXT_RUNTIME"]);

/**
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
  let readsEnvironmentUrls = false;
  for (const file of sourceFiles(SOURCE_ROOTS[processName])) {
    const scanned = scanSourceText(readFileSync(join(REPOSITORY_ROOT, file), "utf8"));
    for (const name of scanned.names) found.add(name);
    for (const prefix of scanned.rateClassPrefixes) rateClassPrefixes.add(prefix);
    if (scanned.readsEnvironmentUrls) readsEnvironmentUrls = true;
  }
  if (readsEnvironmentUrls) {
    for (const name of environmentDatabaseUrlVariables()) found.add(name);
  }
  for (const prefix of rateClassPrefixes) {
    found.delete(prefix);
    for (const suffix of suffixes) found.add(`${prefix}${suffix}`);
  }
  for (const name of FRAMEWORK_PROVIDED) found.delete(name);
  return found;
}

const UNCONDITIONAL_ENTRY = "export function loadConfig(env: Env): Config {";

/**
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
 * Bounded to `loadConfig`'s own body: a helper name says how strictly a value is
 * validated if the parse is reached, not whether an operator must set it. A helper
 * called behind a guard yields a conditional variable, which is why those are absent
 * from this map by construction.
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

/**
 * @param {string[][]} rows
 * @returns {string[]}
 */
function markdownTable(rows) {
  const widths = rows[0].map((_, index) =>
    Math.max(3, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const renderRow = (row) =>
    `| ${row.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  return [
    renderRow(rows[0]),
    renderRow(widths.map((width) => "-".repeat(width))),
    ...rows.slice(1).map(renderRow),
  ];
}

export function renderEnvReference() {
  const lines = [BEGIN_MARKER, ""];
  for (const group of GROUPS) {
    const rows = ENV_REFERENCE.filter((entry) => entry.process === group.process);
    lines.push(`#### ${group.title}`, "", group.blurb, "");
    const table = [["Variable", "Required", "Default", "Meaning"]];
    for (const entry of rows) {
      const name = entry.secret === true ? `\`${entry.name}\` (secret)` : `\`${entry.name}\``;
      table.push([name, requirementCell(entry), defaultCell(entry), entry.description]);
    }
    lines.push(...markdownTable(table));
    lines.push("");
  }
  lines.push(END_MARKER);
  return lines.join("\n");
}

/**
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
// Referenced so the import stays live for the JSDoc-typed path helpers above.
void fileURLToPath;
