# Deployment plan

**Status:** the map. It names the hosting shapes QCMS fits, the invariants every one of them has to
preserve, and the delivery pattern that gets an image onto any of them. It decides nothing that
`docs/deploy-ingress.md` already decided: that document is authoritative for ingress and TLS
(**ADR-20**, `docs/adr/core.md`), `docs/operations.md` is authoritative for the environment
and the runbooks, and `docs/backup-restore.md` is authoritative for backups. Where this document
and one of those disagree, they are right.

QCMS is four containers and one durable thing: the respondent portal, the authoring admin, the API,
and Postgres (`docker-compose.yml`). Only the database has to survive. That is a small enough shape
that the interesting question is not "can this platform run it" but "what does this platform charge
for keeping one Node process warm", and the answers differ by roughly a factor of eight.

## The recommendation

**Run the repo's own Compose stack on one small VPS, essentially unmodified**:
`docker-compose.yml` plus the Caddy overlay in `docker-compose.proxy.yml`, with two DNS records and
automatic Let's Encrypt certificates. That is **Recipe A**, and it is already written out
end to end in `docs/deploy-ingress.md`. Nothing here re-documents it. What this document adds is
why it wins and what a different choice has to reproduce.

It wins because the four properties that are hard everywhere else are free here. The API is not
routable because the file publishes no port for it. Migration runs before the API starts because
Compose says `service_completed_successfully`. The API stays warm because `restart: unless-stopped`
means it is always the same process. The forwarded-address chain is exactly one hop because
`docker/Caddyfile` sets it. On a platform with no VM, each of those becomes a thing you configure,
and the fourth of them is a security control.

## The tiers

Prices are illustrative, in US dollars, gathered 2026-09-01, for roughly 2 vCPU and 4 GB with a
persistent volume. **Confirm every one of them at signup**: vendor pricing moves, and regional
pricing moves more. Ease is 1 (most work) to 5 (least).

| Platform                    | Tier                     | ~Monthly  | Ease | AU region             | Note                                                                          |
| --------------------------- | ------------------------ | --------- | ---- | --------------------- | ----------------------------------------------------------------------------- |
| Hetzner CX23                | own-a-box                | $8-9      | 3    | no (EU and US only)   | Cheapest credible box. Recipe A unmodified. EU latency from Australia.        |
| DigitalOcean droplet (SYD1) | own-a-box                | $13-15    | 3    | yes, Sydney           | Recipe A unmodified, in-region. The default recommendation below.             |
| Hostinger KVM 2             | own-a-box                | $8-12     | 3    | check at signup       | Same shape as the two above; verify the region list before committing.        |
| Fly.io                      | container-native         | $10-50    | 4    | yes, `syd`            | No VM to patch. Machines must be pinned always-on, see invariant 3.           |
| Azure Container Apps        | container-native         | $22-48    | 3    | yes, Australia East   | Managed Postgres beside it. Scale-to-zero must be turned off.                 |
| Render                      | managed PaaS             | ~$27      | 5    | check at signup       | Fixed monthly, near-zero ops. Three services plus a managed Postgres.         |
| Railway                     | managed PaaS             | $10-20    | 5    | check at signup       | Usage-metered, so the bill moves with traffic rather than being fixed.        |
| AWS ECS + Fargate           | cloud LB                 | $66-79    | 1    | yes, `ap-southeast-2` | This is **Recipe B** in `docs/deploy-ingress.md`. Overkill for a solo launch. |
| Cloudflare                  | ingress only, not a host | free tier | n/a  | global edge           | Cannot host the stack. Ideal in front of one, see below.                      |

Three notes on that table.

**AWS is a real answer to a question this project is not asking.** Recipe B is written out in
`docs/deploy-ingress.md` and is correct: an ALB, three ECS services, no target group for the API.
It costs five to eight times a droplet, and most of that is the load balancer and the managed
database rather than compute. Choose it when an organisation already runs AWS and the account,
the VPC and the on-call rotation exist. Do not choose it to launch.

**Cloudflare cannot host this stack, and it is worth being precise about why**, because the
platform is otherwise so attractive that the question keeps coming back. Workers have no persistent
local disk, so there is nowhere for Postgres to live and Cloudflare offers no managed Postgres of
its own. Execution is request-scoped and idles out, which collides directly with invariant 3 below:
the API's outbox deliverer and retention sweep are timers inside a long-lived process, not HTTP
handlers, and a platform that stops the process between requests stops them too.

**What Cloudflare is excellent at is the layer in front.** Put it ahead of whichever host you pick
and take the WAF, Access on the admin hostname, and R2 for off-host backup storage, mostly on free
tiers. That choice is not free of consequences: it adds a proxy hop, which is invariant 4.

## The five invariants

These hold on every platform in the table. Each one is a control the repository already implements
in one shape; a platform that cannot express that shape has to reproduce the property some other
way, and the reproduction is the deployment work.

### 1. The API is never reachable from the internet

ADR-20, and the channel between a BFF and the API is authenticated by the SEC-4 internal token
rather than by network position alone. In Compose this is the **absence** of a `ports:` block on the
`api` service, asserted against the merged configuration by `scripts/compose-config.test.ts`.

Elsewhere it is two questions, and both must be answered: is there a route to the API, and is there
a path to it. Recipe B answers them with no target group and a security group that admits only the
two BFF task groups. A PaaS that gives every service a public hostname by default answers them by
making the API service private, and the first thing to verify after any deploy is that its public
URL is gone. Postgres carries the same rule.

### 2. The one-shot migration completes before the API starts

Migration is a deliberate step, never migrate-on-boot, because more than one API process would mean
more than one racing migrator (`docs/deploy-enterprise.md` §4). Compose enforces the ordering with
`depends_on: migrate: condition: service_completed_successfully`, running the `qcms-db-migrate` bin
from the API image.

A platform with no Compose file reproduces it as a pipeline gate that blocks the release:

| Platform             | The gate                                                                    |
| -------------------- | --------------------------------------------------------------------------- |
| Fly.io               | `release_command`, which runs against the new release before it is promoted |
| Render, Railway      | the pre-deploy command                                                      |
| Azure Container Apps | a job execution, run and awaited before the app revision is activated       |
| AWS ECS              | `run-task` on the migration task definition, waited on before the deploy    |

The failure to avoid is running the migration as a sidecar or an init step of the API service
itself, which reintroduces the race the separate step exists to prevent.

### 3. The API instance must stay warm

**This is the most common way a QCMS deployment breaks quietly, and it is a platform-selection
decision rather than a configuration one.** The solo topology runs the API with `QCMS_MOUNT=all`,
and a mount that includes `internal` is what starts the two background schedulers in-process: the
outbox deliverer (`QCMS_OUTBOX_INTERVAL_MS`, default 5s) and the retention sweep
(`QCMS_RETENTION_SWEEP_INTERVAL_MS`, default 1h). `docs/deploy-enterprise.md` §5 states the rule in
its enterprise form: `internal` is the scheduler flag.

So any platform that scales the API to zero, sleeps it on idle, or freezes it between requests
stops delivering webhooks and stops sweeping expired sessions and aged payloads, **without an error
anywhere**. Nothing 500s. HTTP still works, because HTTP is what wakes the process up. The symptom
is a webhook consumer reporting late or missing deliveries days later, and the diagnosis is in
`docs/operations.md` under webhook dead-letters.

On Fly.io that means the API machine is pinned always-on rather than auto-stopped. On Azure
Container Apps it means a minimum replica count of one. On Render and Railway it means a paid
always-on service rather than a free sleeping one. Exactly one process may carry `internal`: two
copies give you two deliverers and two sweeps, which is doubled polling for no throughput
(`docs/deploy-enterprise.md` §5).

### 4. The trusted-proxy hop counts must match the real ingress chain

`QCMS_PORTAL_TRUSTED_PROXY_HOPS` and `QCMS_ADMIN_TRUSTED_PROXY_HOPS` both default to `1`, which is
correct for both recipes in `docs/deploy-ingress.md` and wrong the moment anything else joins the
path. Each app counts that many entries from the **right** of the inbound `X-Forwarded-For`, and
acts on what it finds: the API's respondent rate limiters key on the portal's answer, and
better-auth's per-IP sign-in throttle keys on the admin's.

**Setting a count higher than the number of proxies that actually exist is a security bug, not a
misconfiguration.** The resolver reads past every entry a proxy wrote and into text the client
chose, so a caller picks its own rate-limit bucket and per-address limiting stops existing. Nothing
in the stack can detect it, because a forged chain and an honest one look identical.

Count the hops on the deployed path, not the intended one. A PaaS router in front of the app is a
hop. A CDN in front of that is a second. `docs/deploy-ingress.md`, "Stacking another proxy", is
authoritative for how to raise the count safely, and the load-bearing half is that raising the
variable alone is the bypass: the proxy nearest the app must be configured to trust the one in
front of it first.

### 5. Back up Postgres and the key material, separately

Postgres is the only durable state, so `pg_dump` is the whole of the data backup, and
`docs/backup-restore.md` has the procedure, the flags and the drill. The half that gets forgotten:
**the keys are deliberately not in the dump.**

`QCMS_APP_KEY` encrypts webhook signing secrets at rest, and `QCMS_ADMIN_AUTH_SECRET` encrypts
stored two-factor material, both TOTP secrets and recovery codes. A dump restored beside a
different `QCMS_ADMIN_AUTH_SECRET` locks every administrator out of 2FA, and nothing resets 2FA
today (issue #432). `QCMS_LINK_KEYS` and `QCMS_SESSION_KEYS` are milder: losing them invalidates
outstanding secure links and respondent sessions. Back the key material up on the same schedule as
the database and store it somewhere the dump is not, so one compromise is not both.

## Restricting the admin surface

The authoring admin is on the public internet in every tier above, because a budget box has no VPN
and the segmented alternative is `docs/deploy-enterprise.md`, which is a different deployment. That
is defensible rather than merely tolerated: `QCMS_ADMIN_2FA` defaults to `required`, so TOTP is
mandatory on every admin account (SEC-1), and there is no self-registration path in any composition.

Adding a second gate in front of it is cheap, and there are three that fit a single box:

| Option                       | Where it lives                                   | Cost of getting it wrong                                                                     |
| ---------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `remote_ip` allowlist        | the admin site block in `docker/Caddyfile`       | You lock yourself out when your own address changes. Best where the authors have static IPs. |
| `basic_auth`                 | the same site block                              | One more shared credential to rotate; it is a speed bump, not an identity.                   |
| Cloudflare Access, free tier | in front of the admin hostname, no edit to Caddy | Real identity, and it changes the proxy chain. See the paragraph below.                      |

The first two edit `docker/Caddyfile`, which is safe to edit for this purpose:
`scripts/compose-config.test.ts` whitelists the file's **upstreams**, and neither directive adds
one, so the routing property stays asserted.

**If you choose Access, invariant 4 moves.** The admin hostname becomes proxied, so Caddy's
`{remote_host}` reports Cloudflare's egress node rather than the administrator. Both halves are
required: configure `trusted_proxies` for Cloudflare's ranges in `docker/Caddyfile` and let Caddy
append rather than set, **and then** raise `QCMS_ADMIN_TRUSTED_PROXY_HOPS` to `2`. Raising only the
variable is exactly the bypass invariant 4 describes. `docs/deploy-ingress.md`, "Stacking another
proxy", is the procedure. Leave `QCMS_PORTAL_TRUSTED_PROXY_HOPS` at `1` if the portal hostname is
not proxied: the two variables exist because the two hostnames can differ.

## Delivery through GitHub Actions

Today `.github/workflows/images.yml` builds all three images on every push, with an SBOM, a
provenance attestation and a real version stamp, and **pushes them nowhere**. That is fine for a
Compose deployment that builds on the box, and it is the one thing that has to change before any
other platform is possible, because every VM-less platform pulls images rather than building them.

**Step 0, on every platform: push to GHCR.** It is free for this repository, it authenticates with
the built-in `GITHUB_TOKEN` under `packages: write`, and it introduces no external credential to
store or rotate. Publishing an image to a registry is a distribution decision and does not touch
ADR-20, whose subject is host ports and public routing rather than registries.

The deploy job that follows is per-platform, and only its credential model really varies:

| Platform               | How the job authenticates                                                        |
| ---------------------- | -------------------------------------------------------------------------------- |
| AWS, Azure             | OIDC federation, keyless. No long-lived secret in the repository at all.         |
| Fly.io, Cloudflare     | a scoped deploy token in repository secrets, rotated on a schedule               |
| Render, Railway        | a deploy hook or scoped token, same rotation rule                                |
| A VPS running Recipe A | SSH, then `docker compose pull` and `up --detach` with `.env` kept on the server |

Four rules hold across all of them:

- **The `.env` never leaves the server**, on the VPS pattern. The workflow pulls and restarts; it
  does not template configuration. Secrets belong to the host or to the platform's own secret
  store, not to the deploy job.
- **Migration is a gate, not a step of the app** (invariant 2). Off a VM it runs before the new
  revision is promoted, and a failure stops the deploy rather than half-completing it.
- **Deploy the trio API-first**, then portal and admin. Both BFFs call the API, and neither is
  useful ahead of it.
- **Verify invariant 1 after the first deploy of any new platform**, by hand. Ask what the API's
  public hostname is, and confirm the honest answer is that it has none.

The concrete workflow files are not in this document. See the per-platform plan under `docs/deploy/`
for the platform you pick.

## Per-platform plans

This document stays platform-agnostic so the choice can be made without rewriting it. The mechanics
of a given platform live beside it:

- [`docs/deploy/vps.md`](deploy/vps.md) - the own-a-box tier: Hetzner, DigitalOcean, Hostinger, all
  running Recipe A.
- [`docs/deploy/fly.md`](deploy/fly.md) - Fly.io machines, volumes, and `release_command` as the
  migration gate.
- [`docs/deploy/cloudflare.md`](deploy/cloudflare.md) - Cloudflare as the ingress layer in front of
  another host: WAF, Access, R2, and the hop count that comes with them.
- [`docs/deploy/aws.md`](deploy/aws.md) - ECS and Fargate, the concrete form of Recipe B.
- [`docs/deploy/azure.md`](deploy/azure.md) - Azure Container Apps, jobs, and Flexible Server.
- [`docs/deploy/paas.md`](deploy/paas.md) - Render and Railway, where the platform owns most of the
  invariants and you verify rather than configure them.

## Choosing

For this project as it stands, solo and cost-sensitive with an Australian owner, the default is a
**DigitalOcean droplet in Sydney** running Recipe A: in-region latency, one box to patch, and the
Compose file used as shipped. **Hetzner CX23** is the same deployment for roughly half the money if
European latency for respondents is acceptable, which for an asynchronous questionnaire it often is.

**Fly.io** is the answer if the preference is container-native with no VM to maintain, and the
price of that preference is remembering invariant 3 every time a machine is reconfigured.
**Render** buys the least operational work for a fixed monthly figure. **AWS** waits until an
organisation is already there.

None of those choices invalidates this document. The invariants are the same five in every column.

## Related

- Ingress, TLS and the two shipped recipes: [`docs/deploy-ingress.md`](deploy-ingress.md).
- The environment reference, health semantics, upgrade procedure and runbooks:
  [`docs/operations.md`](operations.md).
- Backup policy, the restore procedure and the drill: [`docs/backup-restore.md`](backup-restore.md).
- The segmented multi-instance topology, and the scheduler-ownership rule invariant 3 rests on:
  [`docs/deploy-enterprise.md`](deploy-enterprise.md).
- **ADR-20**, the four-container solo topology: [`docs/adr/core.md`](adr/core.md). The operability
  budget it serves: [`docs/PROJECT_GOAL.md`](PROJECT_GOAL.md) §7.
