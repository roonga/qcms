# Deploy QCMS on Fly.io

**Audience:** an operator who wants the solo QCMS topology running without owning a VM, on a
container-native platform. This is the recommended no-VM middle tier: cheaper and simpler than a
cloud load balancer (Recipe B in `docs/deploy-ingress.md`), more managed than a single VM (Recipe
A). **Prerequisite reading:** `docs/deploy-ingress.md` (the trusted-proxy hop model and the six
ingress invariants), `docs/operations.md` (the per-variable environment reference and health
semantics), and `docs/backup-restore.md` (the `pg_dump` drill this doc reuses).

This is the concrete plan behind the `docs/deploy.md` platform index (written separately). It does
not restate ADR-20 or SEC-9; it maps them onto Fly primitives.

**Sources are current as of 2026-09-01 and are listed at the foot of this document. Fly prices and
free-tier rules change; confirm every figure at signup.** There is no permanent free tier for new
Fly organizations (removed in 2024; new accounts get a one-time trial credit), so treat this as a
paid deployment from day one.

## Why Fly fits QCMS

Fly gives you the two properties ADR-20 asks of ingress without a VM to administer:

- **A flat private network.** Every app in a Fly organization joins a private IPv6 mesh (6PN) and
  gets an internal DNS name, `<app>.internal`. An app with **no public IP allocated** is reachable
  only by its siblings on that mesh. That is how the API stops being internet-reachable here, and
  it is stronger than "no route": there is no public address to route to at all.
- **Automatic TLS at the edge.** An app with an `[http_service]` block and a public IP gets Fly's
  proxy in front of it, terminating TLS and appending the client address to `X-Forwarded-For`. The
  apps still speak plain HTTP on 6PN and hold no certificate (invariant 1).

## The three apps

One Fly app per QCMS image. Postgres is separate (see below). Only the portal is public.

| Fly app       | Image         | Public IP           | Reached by                                                 | Always-on?                        |
| ------------- | ------------- | ------------------- | ---------------------------------------------------------- | --------------------------------- |
| `qcms-portal` | `qcms-portal` | yes (Fly proxy/TLS) | respondents, on the internet                               | recommended; may autostop         |
| `qcms-admin`  | `qcms-admin`  | **none**            | the operator, over WireGuard (see "Restricting the admin") | recommended; may autostop         |
| `qcms-api`    | `qcms-api`    | **none**            | the portal and admin BFFs, at `qcms-api.internal:3000`     | **required, never scale to zero** |

The API and admin publish no public address; that is ADR-20 invariants 3 and 4 expressed as "no IP
allocated" rather than "no route configured". Portal and admin are pure BFFs with no schedulers, so
they may scale to zero to trim cost. **The API may not** - see the trap below.

### `qcms-api` fly.toml: the parts that matter

```toml
app = "qcms-api"
primary_region = "syd"   # your region

[build]
  # CI deploys with `flyctl deploy --image ghcr.io/<owner>/qcms-api:<tag>`,
  # which overrides this. A bare `fly deploy` would build from source instead.
  image = "ghcr.io/<owner>/qcms-api:latest"

[deploy]
  # The one-shot migration, run before the new release is promoted. This is the
  # exact compose semantics: docker-compose.yml runs `qcms-db-migrate` (the bin
  # @qcms/db puts on PATH) as the `migrate` one-shot and gates `api` on its success.
  # Use the bin, not a deep `node .../dist/migrate.js` path: that path bypasses the
  # package's exports map and breaks when the layout changes (issue #294). Fly's
  # release_command runs in a throwaway machine with this app's env and secrets, and
  # a non-zero exit aborts the deploy - the same "migrate must pass before the API
  # starts" contract.
  #
  # It inherits THIS APP's env, and this app's DATABASE_URL is the SEC-10 runtime
  # credential, which holds no DDL and cannot migrate. So the command overrides it
  # for its own run from a second secret. The serving process is untouched and still
  # connects as qcms_app. See "Secrets" below.
  release_command = "sh -c 'DATABASE_URL=\"$QCMS_MIGRATE_DATABASE_URL\" qcms-db-migrate'"

[env]
  PORT = "3000"
  QCMS_MOUNT = "all"   # solo: one process serves every surface and owns the schedulers

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"     # 256mb also boots; 512 leaves headroom for the API + pool

# CRITICAL. The API hosts the in-process outbox deliverer and the retention sweep
# (docs/ARCHITECTURE.md; the same schedulers docs/deploy-enterprise.md pins to the
# internal mount). If this machine scales to zero, webhook delivery silently stalls
# and retention stops running - no error, no route down, just work that never
# happens. So the API is always-on, explicitly:
[[services]]
  internal_port = 3000
  protocol = "tcp"
  auto_stop_machines = "off"      # never let the proxy stop it
  auto_start_machines = false
  min_machines_running = 1        # keep exactly one up in the primary region
  # No `ports` handlers are declared, so Fly Proxy exposes nothing publicly even
  # if an IP were ever allocated. Siblings reach this app directly over 6PN.

  [[services.tcp_checks]]
    interval = "15s"
    timeout = "2s"
    grace_period = "10s"
```

**Do not allocate a public IP for this app.** Never run `fly ips allocate` against `qcms-api`, and
do not add an `[http_service]` block (which requests one on deploy). Verify after the first deploy:

```sh
fly ips list -a qcms-api      # expect an empty list
fly ips list -a qcms-admin    # expect an empty list
fly ips list -a qcms-portal   # expect one v4 (shared is fine) and one v6
```

An empty IP list on `qcms-api` is the Fly-native form of the routing test in
`docs/deploy-ingress.md` ("does any listener rule reach the API"): here the honest answer is that
there is nothing to reach.

### portal and admin env

Both BFFs find the API by its internal name. In each app's `[env]` (or as a secret, since it is not
sensitive, `[env]` is fine):

```toml
QCMS_API_BASE_URL = "http://qcms-api.internal:3000"
```

Plain `http` is correct: this hop is inside the 6PN mesh, never on the internet (the same private
HTTP hop SEC-9 describes, `docs/deploy-ingress.md` invariant 1). The portal additionally needs
`QCMS_PORTAL_BASE_URL` set to its public `https://` origin, and the admin needs
`QCMS_ADMIN_BASE_URL` set to whatever origin the operator's browser actually uses to reach it (see
below) - both are load-bearing per the invariants table in `docs/deploy-ingress.md`.

The portal keeps a normal `[http_service]`:

```toml
[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "stop"     # a pure BFF may sleep; respondents pay a cold start
  auto_start_machines = true
  min_machines_running = 1        # set 0 to save ~$2/mo at the cost of first-hit latency
```

## Postgres: three paths, one honest tradeoff

QCMS's only stateful component is Postgres. You are choosing where it lives, and the cost gap is most
of the decision - with one durability caveat that rules a cheap option out for the long term.

| Path                          | What it is                                              | Reached over                | Rough cost (confirm at signup) |
| ----------------------------- | ------------------------------------------------------- | --------------------------- | ------------------------------ |
| **A - Fly Managed Postgres**  | Fly's managed MPG, Basic plan (Shared-2x, 1 GB)         | 6PN, `postgres://` internal | **~$55-65/mo** all-in          |
| **B - self-run on a Machine** | a Postgres you run yourself on a Fly Machine + a volume | 6PN, `postgres://` internal | **~$30-35/mo** all-in          |
| **C - external free-tier**    | Neon (or similar) serverless Postgres, reached over TLS | public endpoint, TLS        | **~$10-15/mo** all-in          |

**The durability caveat, before you pick on price alone.** Fly has signalled that it will not support
the **self-run** Postgres shape (Path B) long-term: its own docs call unmanaged Fly Postgres "not a
managed database", it is explicitly unsupported by Fly Support (you own operations, backups, and
disaster recovery), and Fly is steering everyone to Managed Postgres. So treat Path B as transitional
at best. **Managed (A) or external (C) is the durable choice**; do not build a long-lived deployment
on B.

One genuine plus across all three: Fly's Sydney region (`syd`) is a real, first-class region, so an
AU deployment keeps both the apps and an internal-network database in-country.

### Path A - Fly Managed Postgres (MPG)

The low-friction, durable path: MPG lives on the same 6PN mesh, so the API reaches it by internal
name with no public database endpoint, and Fly runs the backups. Provision it, then attach its
connection string as a secret:

```sh
fly mpg create --name qcms-db --plan basic --region syd
# then set DATABASE_URL on the API app (see Secrets below)
```

MPG Basic is a ~$38/mo floor plus storage (at ~$0.28/provisioned GB), which lands the all-in figure
around ~$55-65/mo once the three app machines and storage are counted. It is the right choice when
you would rather not run a `pg_dump` cron and want backups handled by the platform. Confirm the
current plan shape and price at signup: MPG pricing has moved more than once.

### Path B - self-run Postgres on a Fly Machine (transitional)

You can run a Postgres container on a Fly Machine with a persistent volume, on the same 6PN mesh, for
roughly ~$30-35/mo all-in (a larger Machine for the database plus volume storage, beside the three
app machines). It is cheaper than MPG and keeps the database internal.

**Read the durability caveat above before choosing this.** It is unsupported by Fly, you own its
backups and recovery entirely (run the `pg_dump` drill below as if it were an external database), and
Fly is retiring the shape. Use it only for a short-lived or throwaway deployment where you will
migrate to MPG or an external provider before it matters. For anything long-lived, pick A or C.

### Path C - external free-tier Postgres (Neon), over TLS

Point `DATABASE_URL` at a Neon database over its public TLS endpoint. The API's egress reaches it
fine (Fly apps have outbound internet by default). This trims the database line to ~$0, but read the
two caveats honestly:

- **The free tier is a pilot allowance, not a production floor.** Neon's free plan meters compute in
  compute-hours (100/month at time of writing) and autosuspends after a few minutes idle. The QCMS
  API is deliberately always-warm and its schedulers poll, so the database rarely idles - an
  always-on instance can exhaust a monthly compute-hour cap and be suspended until the next cycle.
  For anything past a pilot, budget for the provider's smallest paid always-on tier (a few dollars a
  month), which is why Path C is priced at ~$10-15 all-in, not ~$6.
- **Backups are now yours.** Run the documented drill from `docs/backup-restore.md` on a schedule.
  A minimal `pg_dump` cron, pushed to object storage, is the whole obligation:

  ```sh
  # nightly, from any machine that can reach the database and holds DATABASE_URL
  pg_dump "$DATABASE_URL" --format=custom --file "qcms-$(date -u +%F).dump"
  # then copy it off-box - see docs/deploy/cloudflare.md for a Cloudflare R2 target (free tier)
  ```

  `docs/deploy/cloudflare.md` sketches an R2 destination whose free tier fits a solo instance's
  dumps at $0.

Either way, `DATABASE_URL` is a secret and belongs only to the API (ADR-35): the admin and portal
never hold a database credential.

## Restricting the admin

ADR-20 places the authoring admin behind "VPN or internal" access. Fly gives you that literally,
with no third party, through its own WireGuard support.

### Primary: Fly-native operator WireGuard

The admin app has no public IP (above), so it is already unreachable from the internet. To let a
known operator reach it, create a WireGuard peer into the organization's private network and bring
the tunnel up on the operator's machine:

```sh
fly wireguard create <org> syd operator-laptop ./fly-operator.conf
# import fly-operator.conf into WireGuard; while the tunnel is up, 6PN names resolve
```

With the tunnel up, the operator can reach `qcms-admin` on 6PN. This meets ADR-20's "VPN/internal"
requirement natively: the tunnel is the access control, and nothing about the admin is exposed to
anyone without a peer config.

**One honest wrinkle, because QCMS's own guards will otherwise stop you.** The admin marks its
cookies `Secure` in production, and it **refuses to start** with `QCMS_ADMIN_SECURE_COOKIES=false`
unless its base URL is loopback (the guard from issue #292, documented in `docs/deploy-ingress.md`).
Browsers only send `Secure` cookies over `https` or to `http://localhost` - not to a plain-`http`
internal address over the tunnel. So reaching the admin over WireGuard needs a real `https` origin:
terminate TLS on the private side (a small Caddy or equivalent machine holding a certificate the
operator's browser trusts, fronting `qcms-admin` on 6PN), set `QCMS_ADMIN_BASE_URL` to that `https`
origin, and leave `QCMS_ADMIN_SECURE_COOKIES` unset. Plain-`http`-over-WireGuard alone will loop at
sign-in, by design.

Because the operator then reaches the admin **directly** on the private network (no client-facing
proxy appends `X-Forwarded-For`), set `QCMS_ADMIN_TRUSTED_PROXY_HOPS=0`: the only forwardable
address would be one the browser wrote, and per `docs/deploy-ingress.md` the safe reading of a
directly-reachable app is to trust no forwarded entry. The admin is a small, tunnel-gated operator
set, so a single shared sign-in-throttle bucket is acceptable here.

### Alternative: Cloudflare Access in front

If the TLS-on-the-tunnel step above is more than you want to run, `docs/deploy/cloudflare.md`
describes fronting the admin with Cloudflare Access plus a `cloudflared` Tunnel: a real `https`
origin, gated to your team (free for up to 50 users), with **no public origin on Fly at all** because
the Tunnel dials out from the admin machine. That path also closes the direct-to-origin bypass that
Access alone would leave open. It is the browser-simplest admin restriction; WireGuard is the
no-third-party one. Pick one, not both.

## Secrets

Set secrets per app with `fly secrets set`; they are encrypted at rest and injected as environment
at boot. The split follows ADR-35 exactly - the API holds everything, the BFFs hold only the
internal token.

```sh
# API: the database credentials plus the full secret set.
#
# TWO database URLs, and the split between them is SEC-10 (docs/operations.md,
# "Least-privilege database roles"). DATABASE_URL is the qcms_app role the process
# serves traffic as: DML only, no DDL, not the schema owner. QCMS_MIGRATE_DATABASE_URL
# is the qcms_migrate role, read by nothing but the release_command in fly.toml.
#
# Fly gives a release_command no environment of its own, so unlike Compose the two
# secrets live on one app. The control that survives is the one that matters: the
# long-running process cannot DROP TABLE, whatever a request does to it.
fly secrets set -a qcms-api \
  DATABASE_URL="postgres://qcms_app:..." \
  QCMS_MIGRATE_DATABASE_URL="postgres://qcms_migrate:..." \
  QCMS_INTERNAL_TOKEN="..." \
  QCMS_APP_KEY="..." \
  QCMS_SESSION_KEYS="..." \
  QCMS_LINK_KEYS="..." \
  QCMS_ADMIN_AUTH_SECRET="..." \
  QCMS_PORTAL_BASE_URL="https://forms.example.com" \
  QCMS_ADMIN_BASE_URL="https://admin.internal.example.com"

# portal and admin: the shared internal token only (no DATABASE_URL, ever)
fly secrets set -a qcms-portal QCMS_INTERNAL_TOKEN="..."
fly secrets set -a qcms-admin  QCMS_INTERNAL_TOKEN="..."
```

The full list and the boot-time refusal on a placeholder secret are in `docs/operations.md` and
`apps/api/src/config.ts`. Setting a secret triggers a rolling restart of that app.

### Trusted-proxy hops on Fly

Fly Proxy appends the connecting client's address to `X-Forwarded-For` as the rightmost entry, so
the portal's chain is exactly `<client>` after one proxy:

| Hostname                                 | In front of it              | Set                                                        |
| ---------------------------------------- | --------------------------- | ---------------------------------------------------------- |
| portal (public)                          | Fly Proxy only              | `QCMS_PORTAL_TRUSTED_PROXY_HOPS=1` (default)               |
| portal, + Cloudflare                     | Cloudflare, then Fly Proxy  | `QCMS_PORTAL_TRUSTED_PROXY_HOPS=2`                         |
| admin (over WireGuard, direct)           | nothing (direct 6PN)        | `QCMS_ADMIN_TRUSTED_PROXY_HOPS=0`                          |
| admin, behind Cloudflare Access + Tunnel | `cloudflared`, then the app | `QCMS_ADMIN_TRUSTED_PROXY_HOPS=1` (see the Cloudflare doc) |

The reasoning, and why a hop count set **higher** than the real chain is a rate-limit bypass rather
than an outage, is `docs/deploy-ingress.md` "The forwarded client address". Layering Cloudflare is
the "Stacking another proxy" case there: raise the count **and** trust the proxy, never one half.

## TLS

Automatic for the portal. Fly issues and renews a certificate for the portal's public hostname once
you point DNS at it and register it:

```sh
fly ips list -a qcms-portal            # note the v4/v6 to put in DNS
fly certs add forms.example.com -a qcms-portal
```

No certificate lives in any QCMS container (invariant 1). The admin's `https` origin, if you take the
WireGuard path, is the private TLS terminator you run; if you take the Cloudflare path, it is
Cloudflare's edge certificate.

## Cost

Smallest viable, all three machines always-on, one region. **Confirm every figure at signup (as of
2026-09-01); there is no free tier for a new org.**

| Line item                              | A (MPG)                     | B (self-run, transitional)       | C (external DB)                   |
| -------------------------------------- | --------------------------- | -------------------------------- | --------------------------------- |
| `qcms-portal` shared-cpu-1x, always-on | ~$2/mo                      | ~$2/mo                           | ~$2/mo                            |
| `qcms-admin` shared-cpu-1x, always-on  | ~$2/mo                      | ~$2/mo                           | ~$2/mo                            |
| `qcms-api` shared-cpu-1x, always-on    | ~$2/mo                      | ~$2/mo                           | ~$2/mo                            |
| Postgres                               | MPG Basic ~$38/mo + storage | a DB Machine + volume ~$25-30/mo | external free/entry tier ~$0-6/mo |
| **Rough total**                        | **~$55-65/mo**              | **~$30-35/mo**                   | **~$10-15/mo**                    |

Path B is the cheapest internal-network option but the one Fly is retiring (see the durability
caveat under "Postgres"); for a long-lived deployment choose A or C. Trimming portal and admin to
`min_machines_running = 0` saves ~$4/mo at the cost of a cold start on the first hit. The API line is
not negotiable: it is always-on by design.

## CI: build, push, deploy

`.github/workflows/images.yml` builds all three images with an SBOM, provenance, and a version
stamp, and publishes them to GHCR on `main` (issue #763), but it **does not deploy** (issue #360).
This workflow adds the missing half: deploy each app by digest. If you would rather not build a
second time, drop the build job and deploy the `ghcr.io/<owner>/qcms-<app>:<commit sha>` tags
`images.yml` already published.

A note on the API image. ADR-20's text is a **runtime network** property - "The API publishes no
host port" - not a rule about image distribution, and the Code Owner confirmed that reading on
2026-09-02 (issue #763): pushing the API image to a registry does not touch ADR-20. What the deploy
below needs is only that the API image is reachable **by the deploy**, so it pushes to a GHCR path
the Fly deploy pulls from. A GHCR package is private when the push first creates it, which is the
conservative default and is what a credentialed Fly pull wants.

```yaml
name: Deploy (Fly)

on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write # push to GHCR

jobs:
  build-push:
    runs-on: ubuntu-latest
    outputs:
      tag: ${{ steps.meta.outputs.tag }}
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # imageVersion() needs a real commit for the version stamp
      - uses: pnpm/action-setup@v6.0.9
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - id: meta
        run: echo "tag=$(git rev-parse --short HEAD)" >> "$GITHUB_OUTPUT"
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      # Reuse the repo's image builder; push each tag to GHCR.
      - name: Build and push the three images
        run: |
          for app in portal admin api; do
            docker buildx build \
              --file "docker/${app}.Dockerfile" \
              --tag "ghcr.io/${{ github.repository_owner }}/qcms-${app}:${{ steps.meta.outputs.tag }}" \
              --build-arg VERSION="${{ steps.meta.outputs.tag }}" \
              --push .
          done

  deploy:
    needs: build-push
    runs-on: ubuntu-latest
    env:
      FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }} # a scoped deploy token, see below
      TAG: ${{ needs.build-push.outputs.tag }}
    steps:
      - uses: actions/checkout@v7
      - uses: superfly/flyctl-actions/setup-flyctl@master
      # API FIRST: its release_command runs the migration before the new release is
      # promoted, so the schema is ready before either BFF talks to it.
      - run: flyctl deploy -a qcms-api    --image "ghcr.io/${{ github.repository_owner }}/qcms-api:${TAG}"
      - run: flyctl deploy -a qcms-portal --image "ghcr.io/${{ github.repository_owner }}/qcms-portal:${TAG}"
      - run: flyctl deploy -a qcms-admin  --image "ghcr.io/${{ github.repository_owner }}/qcms-admin:${TAG}"
```

Two notes on the deploy credential:

- **Fly has no GitHub OIDC trust for deploys.** Unlike a cloud role assumption, there is no
  short-lived-token exchange here; you authenticate `flyctl` with a Fly API token. Create a
  **scoped deploy token** (`fly tokens create deploy -a qcms-api`, and one per app, or an org deploy
  token), store it as the `FLY_API_TOKEN` GitHub secret, and rotate it on a schedule. A scoped
  deploy token can deploy but cannot administer the org, which is the least privilege available.
- **API first is not cosmetic.** Its `release_command` is the migration gate. Deploying a BFF
  against an un-migrated schema is the failure ordering exists to prevent.

## Ease rating and the top gotchas

**Ease: moderate.** Easier than Recipe B (ECS + ALB): no VPC, no target groups, no security-group
matrix - the private mesh and automatic TLS are given. Harder than a single VM (Recipe A): three
apps to configure and a WireGuard or Cloudflare decision for the admin. A first deploy is a
half-day, not a week.

The two things that will actually bite you, in order:

1. **The scale-to-zero trap (the number-one failure).** Leaving the API on Fly's default autostop -
   or copying the portal's `[http_service]` autostop into the API - lets the machine sleep, which
   silently stalls the outbox deliverer and the retention sweep. Nothing errors; webhooks just stop
   arriving. `auto_stop_machines = "off"` and `min_machines_running = 1` on the API are mandatory,
   and stay mandatory even if you later put the API behind Flycast for private load-balancing.
2. **The admin cookie/origin guard.** The admin refuses to run with `Secure` cookies off unless its
   base URL is loopback, so a plain-`http` admin over WireGuard loops at sign-in. Give it a real
   `https` origin (private TLS terminator, or the Cloudflare Access path) and set
   `QCMS_ADMIN_BASE_URL` to match. This surprises everyone once.

## Sources

Retrieved 2026-09-01. Confirm prices and free-tier rules at signup; they change.

- Fly.io fly.toml configuration reference (`[deploy] release_command`, `[http_service]`
  `auto_stop_machines`/`auto_start_machines`/`min_machines_running`, allowed value `"off"`):
  https://fly.io/docs/reference/configuration/
- Fly.io private networking and 6PN (`<app>.internal` DNS, apps with no public IP reachable only on
  the mesh): https://fly.io/docs/networking/private-networking/ and
  https://fly.io/blog/incoming-6pn-private-networks/
- Fly.io Flycast (private Fly Proxy routing, if the API is later load-balanced):
  https://fly.io/docs/networking/flycast/
- Fly.io `fly wireguard create` (operator peer into the org private network):
  https://fly.io/docs/flyctl/wireguard-create/ and https://fly.io/docs/reference/wireguard/
- Fly.io Managed Postgres and pricing (Basic ~$38/mo, Shared-2x/1 GB; storage ~$0.28/provisioned
  GB): https://fly.io/docs/mpg/ and https://fly.io/docs/about/pricing/
- Fly.io unmanaged/self-run Postgres is unsupported and being superseded by MPG ("This Is Not Managed
  Postgres"; own operations, backups, and recovery): https://fly.io/docs/postgres/ and
  https://fly.io/docs/postgres/getting-started/what-you-should-know/
- Fly.io regions, including Sydney (`syd`) as a first-class AU region:
  https://fly.io/docs/reference/regions/
- Fly.io resource pricing and the end of the free tier for new orgs (shared-cpu-1x/256 MB ~$2/mo
  always-on; trial credit only): https://fly.io/docs/about/pricing/ and
  https://fly.io/docs/about/billing/
- superfly/flyctl-actions and continuous deployment with GitHub Actions (`setup-flyctl`,
  `FLY_API_TOKEN`, `flyctl deploy --image`): https://github.com/superfly/flyctl-actions and
  https://fly.io/docs/launch/continuous-deployment-with-github-actions/
- Neon free-tier limits (0.5 GB/project, 100 compute-hours/month, autosuspend after idle):
  https://neon.com/faqs/managed-postgres-databases-free-tier
