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
for keeping one Node process warm", and the answers differ by more than a factor of ten.

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

Prices are illustrative, in US dollars, read off the vendors' own pricing pages on 2026-09-01, for
a stack sized around 2 vCPU and 4 GB with a persistent volume. **Confirm every one of them at
signup**: vendor pricing moves (Hetzner raised these twice in 2026), regional pricing moves more,
and a promotional rate is not a renewal rate. Ease is 1 (most work) to 5 (least).

| Platform                 | Tier                     | ~Monthly             | Ease | AU region                | Note                                                                            |
| ------------------------ | ------------------------ | -------------------- | ---- | ------------------------ | ------------------------------------------------------------------------------- |
| Hetzner CX23             | own-a-box                | ~$7                  | 3    | no, Singapore is nearest | 2 vCPU / 4 GB / 40 GB, plus the IPv4 charge. Cheapest credible box.             |
| DigitalOcean Basic, SYD1 | own-a-box                | $24                  | 3    | yes, Sydney              | 2 vCPU / 4 GB. Recipe A unmodified and in-region. The default recommendation.   |
| Hostinger KVM 2          | own-a-box                | $9 promo, $15 renew  | 3    | no, Singapore is nearest | 2 vCPU / 8 GB. The promotional rate needs a multi-year prepay.                  |
| Fly.io                   | container-native         | $30-35, or $55-65    | 4    | yes, `syd`               | Lower figure self-running Postgres on a Machine, higher with Managed Postgres.  |
| Azure Container Apps     | container-native         | $45-80               | 3    | yes, Australia East      | Three apps at minimum one replica, plus Flexible Server B1ms.                   |
| Render                   | managed PaaS             | $27 floor, ~$81 real | 5    | no, Singapore is nearest | The floor is three 0.5 vCPU / 512 MB instances; the next size up is $25 each.   |
| Railway                  | managed PaaS             | $15-30               | 5    | no, Singapore is nearest | Metered on measured usage, so the bill moves with load rather than being fixed. |
| AWS ECS + Fargate        | cloud LB                 | $72-78               | 1    | yes, `ap-southeast-2`    | **Recipe B** in `docs/deploy-ingress.md`. Add ~$43 per AZ for a NAT gateway.    |
| Cloudflare               | ingress only, not a host | free tier            | n/a  | global edge              | Cannot host the stack. Ideal in front of one, see below.                        |

**Only four of them have an Australian region**: DigitalOcean, Fly.io, Azure and AWS. Hetzner,
Hostinger, Render and Railway all stop at Singapore, which is the closest thing to in-region they
offer. For an asynchronous questionnaire that is usually a preference rather than a requirement,
but it is the one axis where the cheapest option and the local option are not the same option.

Three further notes on that table.

**AWS is a real answer to a question this project is not asking.** Recipe B is written out in
`docs/deploy-ingress.md` and is correct: an ALB, three ECS services, no target group for the API.
It costs three times a Sydney droplet and ten times a Hetzner box, and only about $32 of that is
compute: the rest is the load balancer and the managed database. The figure also assumes tasks in
public subnets. Put them in private ones, as most reference architectures do, and a NAT gateway
adds roughly $43 per availability zone before any data transfer, which is more than the whole
own-a-box tier. Choose AWS when an organisation already runs AWS and the account, the VPC and the
on-call rotation exist. Do not choose it to launch.

**Cloudflare cannot host this stack, and it is worth being precise about why**, because the
platform is otherwise so attractive that the question keeps coming back. Three separate blocks.
Workers are event-driven with a per-request CPU ceiling and no filesystem, so there is nowhere for a
long-lived process to live. Cloudflare Containers are longer-lived but sleep after a default ten
minutes of inactivity and get a **fresh disk from the image** on restart, which is the opposite of
what a database needs. And there is no Cloudflare Postgres to point at instead: D1 is SQLite, and
Hyperdrive is a connection pool and query cache in front of somebody else's Postgres rather than a
database of its own.

The sleep model is the one that would bite hardest, because it collides with invariant 3 below: the
API's outbox deliverer and retention sweep are timers inside a long-lived process, not HTTP
handlers, and a platform that stops the process between requests stops them too.

**What Cloudflare is excellent at is the layer in front.** Put it ahead of whichever host you pick.
The free plan carries one managed WAF ruleset (the broad Cloudflare and OWASP rulesets are Pro and
above, so "free WAF" means high-signal rules rather than full coverage), Zero Trust Access is free
up to 50 users, and R2 gives 10 GB with **no egress charge**, which makes it a good home for the
off-host backups `docs/backup-restore.md` asks for. That choice is not free of consequences: it
adds a proxy hop, which is invariant 4.

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

| Platform             | The gate                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| Fly.io               | `[deploy] release_command`, a one-off Machine on the new image; a non-zero exit aborts the deploy |
| Render, Railway      | the pre-deploy command, which runs after the build and before it is deployed                      |
| Azure Container Apps | a manually triggered job execution, awaited before the new app revision is activated              |
| AWS ECS              | `run-task` on the migration task definition, waited on before the service deploy                  |

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
Container Apps it means a minimum replica count of one, which is also why the cheapest ACA figure in
the table is not the scale-to-zero one. On Render and Railway it means a paid always-on service, not
a sleeping free one. Exactly one process may carry `internal`: two
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

`.github/workflows/images.yml` builds all three images on every push, with an SBOM, a provenance
attestation and a real version stamp, and **publishes them to GHCR on pushes to `main`** (issue
#763). Every VM-less platform pulls images rather than building them, so that publish is step 0 for
all of them. What is in place is the mechanism: the three packages come into existence on the first
`main` push after that change lands, and each later `main` push adds tags. Check the registry for
the tag you mean to deploy rather than assuming it is there.

**Step 0, on every platform: push to GHCR.** It is free for this repository, it authenticates with
the built-in `GITHUB_TOKEN` under `packages: write`, and it introduces no external credential to
store or rotate. Publishing an image to a registry is a distribution decision and does not touch
ADR-20, whose subject is host ports and public routing rather than registries.

What is published, and how to pin it:

- `ghcr.io/roonga/qcms-api`, `ghcr.io/roonga/qcms-portal` and `ghcr.io/roonga/qcms-admin`.
- Two tags per build: the **full commit SHA**, which is immutable, and `latest`, which moves.
  Deploy from the SHA tag. `latest` is a convenience, and two `main` merges building at once can
  finish out of order, so it is the one tag whose meaning depends on timing.
- Not every commit on `main` gets a tag. A docs-only push skips the workflow through `paths-ignore`,
  which is right because the images would be identical, but it means the newest SHA tag can sit a
  commit or two behind the branch tip. A `workflow_dispatch` run on `main` mints the tags for
  whatever commit it checks out.
- A GHCR package is **private** when the first push creates it. Leave it private for a server that
  authenticates its pull, or set it public in the package settings if adopters should pull
  anonymously. That visibility choice belongs to the Code Owner and the workflow does not make it.

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
Compose file used as shipped. **Hetzner CX23** is the identical deployment for under a third of the
money, and the trade is European latency, which for an asynchronous questionnaire is usually
acceptable. That is the one real decision in the cheap tier, and it is a latency question rather
than a technical one, because the deployment is the same either way.

**Fly.io** is the answer if the preference is container-native with no VM to maintain. It has a
Sydney region, and its price depends on a second decision: Managed Postgres roughly doubles the
bill, and running Postgres yourself on a Machine is the cheaper half of the range but is a shape Fly
now says it will not support. **Render** buys the least operational work, but read its floor
carefully: $27 buys three 0.5 vCPU / 512 MB instances, which is tight for two Next processes, and
the next size up triples the bill. **AWS** waits until an organisation is already there.

None of those choices invalidates this document. The invariants are the same five in every column.

## Where these numbers came from

Each figure was read on 2026-09-01 from the vendor's own published pricing, and for AWS and Azure
from their machine-readable price lists (the AWS Price List Bulk API for `ap-southeast-2`, the Azure
Retail Prices API for `australiaeast`) rather than from a marketing page. Two carry a caveat worth
repeating rather than hiding: Hetzner's plan table is script-rendered, so the CX23 monthly figure is
derived from Hetzner's own published hourly rate rather than read off the plan page, and
Cloudflare's Zero Trust seat allowance is widely corroborated but was not confirmable from a
first-party page. Treat every number here as a starting estimate and confirm it at signup.

## Related

- Ingress, TLS and the two shipped recipes: [`docs/deploy-ingress.md`](deploy-ingress.md).
- The environment reference, health semantics, upgrade procedure and runbooks:
  [`docs/operations.md`](operations.md).
- Backup policy, the restore procedure and the drill: [`docs/backup-restore.md`](backup-restore.md).
- The segmented multi-instance topology, and the scheduler-ownership rule invariant 3 rests on:
  [`docs/deploy-enterprise.md`](deploy-enterprise.md).
- **ADR-20**, the four-container solo topology: [`docs/adr/core.md`](adr/core.md). The operability
  budget it serves: [`docs/PROJECT_GOAL.md`](PROJECT_GOAL.md) §7.
