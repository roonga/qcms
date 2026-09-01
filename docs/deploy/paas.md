# Deploy QCMS on a managed container PaaS

**Status:** the concrete, provider-specific plan behind the PaaS recommendation in `docs/deploy.md`. It covers **Render** and **Railway**: managed platforms that build the three Dockerfiles, run a managed Postgres, and terminate TLS for you. It assumes the invariants of `docs/deploy-ingress.md` (portal public, admin restricted, API never publicly reachable) and the environment reference in `docs/operations.md`; read those first. **Pricing** below is illustrative and was retrieved on **2026-09-01**; confirm the current figure at signup.

A PaaS trades the VPS recipe's control (`docs/deploy/vps.md`) for someone else's operations. What you keep responsible for is the same three properties every QCMS deployment must hold: the API stays private, a one-shot migration runs before the API serves the new schema, and the API never scales to zero.

## 1. Pick the platform

The three QCMS Node images are small; **Postgres is the memory-sensitive part**, so the database tier is where you spend first. Both platforms below clear the floor comfortably for a small-to-mid deployment.

| Platform    | Shape                           | Illustrative monthly                                                                                                                  | Best when                                                                                        |
| ----------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Render**  | Fixed plans, one Blueprint file | ~ **$27 floor** (3x Starter @ $7, 0.5 vCPU / 512 MB, + Postgres Basic ~ $6); ~ **$81 realistic** at the next size up (~ $25/instance) | You want a declarative `render.yaml`, predictable flat billing, and a private-service primitive. |
| **Railway** | Usage-metered, per-second       | ~ **$15-30**: $5 Hobby base + metered vCPU (~ $20/vCPU-mo) and RAM (~ $10/GB-mo) across four services                                 | You want to pay for actual consumption on a low-traffic deployment and like config-as-code JSON. |

**Neither Render nor Railway has an Australian region** - Singapore is the nearest for both, so an AU audience pays ~90-120 ms of added RTT on either. If in-region AU latency is the priority, the single-VPS DigitalOcean `SYD1` option in `docs/deploy/vps.md` is the one that delivers it; these two trade that away for managed operations.

Render's **$27 is a floor, not the expected bill**: three 0.5 vCPU / 512 MB Starter instances plus the smallest managed Postgres. That size is fine for a light deployment, but the moment the API or Postgres needs the next tier up (~ $25/instance) a realistic three-service bill lands nearer **$81** before database growth - state both to the Code Owner so the floor is not mistaken for the steady state. Railway meters to the second, so it is cheaper while traffic is low (~ $15-30 for a small deployment) but the bill moves with load; model your steady-state RAM before committing. On **both**, size the API and Postgres above the smallest tier before the smaller front ends: the API holds the only DB handle and the schedulers, and Postgres is what a squeeze starves first.

## 2. Render: the Blueprint

Render reads one `render.yaml` (a Blueprint) at the repo root. Four services and one database, all from the repo's Dockerfiles. The API is a **private service** (`type: pserv`): it gets an internal hostname and **no public URL at all**, which is invariant 4 made structural rather than configured.

```yaml
# render.yaml  (key config; trim to the shape your account supports)
databases:
  - name: qcms-db
    plan: basic-256mb # managed Postgres; PITR on paid tiers (section 6)
    databaseName: qcms
    user: qcms

services:
  # API: PRIVATE. No public route, ever (ADR-20 / invariant 4).
  - name: qcms-api
    type: pserv
    runtime: docker
    dockerfilePath: ./docker/api.Dockerfile
    plan: standard # keep above the smallest tier: only DB handle + schedulers
    preDeployCommand: "qcms-db-migrate" # one-shot migrate (the bin on PATH in the api image)
    envVars:
      - key: QCMS_MOUNT
        value: all
      - key: DATABASE_URL
        fromDatabase: { name: qcms-db, property: connectionString }
      - key: QCMS_LINK_KEYS
        sync: false # set in the dashboard, not in git
      - key: QCMS_SESSION_KEYS
        sync: false
      - key: QCMS_INTERNAL_TOKEN
        sync: false
      - key: QCMS_APP_KEY
        sync: false
      - key: QCMS_ADMIN_AUTH_SECRET
        sync: false
      - key: QCMS_PORTAL_BASE_URL
        value: https://forms.example.org
      - key: QCMS_ADMIN_BASE_URL
        value: https://admin.example.org

  # Portal: PUBLIC web service.
  - name: qcms-portal
    type: web
    runtime: docker
    dockerfilePath: ./docker/portal.Dockerfile
    plan: starter
    envVars:
      - key: QCMS_API_BASE_URL
        # MUST carry an http:// scheme. Both BFFs build fetch URLs as
        # `${QCMS_API_BASE_URL}/...` with no scheme handling, and the private hop is
        # plain HTTP (the SEC-9 model). Render's `fromService`/`hostport` yields a bare
        # `host-hash:port` with NO scheme, and a Blueprint cannot prepend one; the
        # internal host also carries an unpredictable hash. So set this in the dashboard
        # to the API's full internal URL from its Connect > Internal tab, with http://
        # in front, e.g. http://qcms-api-a1b2:3000.
        sync: false
      - key: QCMS_INTERNAL_TOKEN
        sync: false
      - key: QCMS_PORTAL_BASE_URL
        value: https://forms.example.org

  # Admin: web service, restricted at the edge (section 3).
  - name: qcms-admin
    type: web
    runtime: docker
    dockerfilePath: ./docker/admin.Dockerfile
    plan: starter
    envVars:
      - key: QCMS_API_BASE_URL
        # Same as the portal: set in the dashboard to http://<api internal host>:<port>.
        # See the portal service above for why a Blueprint cannot supply this value.
        sync: false
      - key: QCMS_INTERNAL_TOKEN
        sync: false
      - key: QCMS_ADMIN_BASE_URL
        value: https://admin.example.org
```

Notes that matter:

- **`preDeployCommand` is the migration step.** Render runs it once per deploy, after the build and before the new instance takes traffic, which is exactly the one-shot-before-serve ordering `docker-compose.yml` gets from its dependency graph. Point it at the same migrate entrypoint the `migrate` service uses. It runs on the service it is declared on, so declaring it on the API (the process that holds `DATABASE_URL`) is correct.
- **`QCMS_API_BASE_URL` must carry an `http://` scheme, and a Blueprint cannot supply it.** The front ends reach the API on Render's private network over plain HTTP (the SEC-9 model), but both BFFs build fetch URLs as `${QCMS_API_BASE_URL}/...` with no scheme handling, so a bare host:port fails every call. Render's `fromService`/`hostport` yields exactly that bare `host-hash:port`, and the internal host carries an unpredictable hash, so set this value in the dashboard from the API's Connect > Internal tab with `http://` prepended, marked `sync: false` in the Blueprint. (Railway does not hit this, because its variable references interpolate into a string: see section 3.)
- **`sync: false` keeps secrets out of git.** Render prompts for each in the dashboard on first deploy. Generate every one with a CSPRNG at 32+ chars; the API refuses a placeholder.
- Leave `QCMS_SECURE_COOKIES` / `QCMS_ADMIN_SECURE_COOKIES` unset; `NODE_ENV=production` in the images marks cookies `Secure`, correct behind Render's TLS.

## 3. Railway: three services, private API

Railway has no single manifest for the whole project; each service carries its own config-as-code (`railway.json`) and you wire them in the dashboard. Create **four services from the repo Dockerfiles** (api, portal, admin, plus the Railway Postgres plugin for the database), and rely on private networking so **the API gets no public domain**.

Per-service `railway.json` (committed beside each Dockerfile, or set in the UI):

```json
// api service
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "DOCKERFILE", "dockerfilePath": "docker/api.Dockerfile" },
  "deploy": {
    "preDeployCommand": ["qcms-db-migrate"],
    "restartPolicyType": "ALWAYS"
  }
}
```

Wiring:

- **The API has no public domain.** In Railway a service is private unless you generate a domain for it, so simply never click "Generate Domain" on the API. The portal and admin reach it at its internal DNS name. Set on both front ends:
  `QCMS_API_BASE_URL=http://${{qcms-api.RAILWAY_PRIVATE_DOMAIN}}:${{qcms-api.PORT}}` - note **`http://`**, required: the private network does not do TLS, and that plain-HTTP internal hop is exactly the SEC-9 model.
- **`preDeployCommand` on the API service is the migration step**, run once before the new deployment starts serving. Same ordering guarantee as Render's, same entrypoint.
- **`DATABASE_URL`** on the API comes from the Postgres plugin's reference variable (`${{Postgres.DATABASE_URL}}`).
- Set `QCMS_MOUNT=all` and the six secrets on the API service; `QCMS_INTERNAL_TOKEN` and the base URLs on the front ends. Railway's variables are the equivalent of Render's `sync: false` secrets.

## 4. TLS and admin restriction

Both platforms terminate TLS and issue certificates for the public services automatically; you attach your custom domains and they handle the rest. There is no Caddyfile to write.

- **Portal:** public, as intended.
- **Admin:** must be restricted. Neither platform ships an IP allowlist as cleanly as Caddy does, so the two workable gates are:
  1. **Cloudflare Access** in front of the admin's public hostname (SSO / device policy). Best for a roaming admin, and it adds a proxy hop - see section 5.
  2. **The app's own mandatory TOTP.** `QCMS_ADMIN_2FA` defaults to `required` and sign-in is brute-force throttled (SEC-1), so even a publicly reachable admin origin is behind a second factor and per-address backoff. This is the floor; Cloudflare Access on top is the recommended belt.
- **Keep the API private** by construction: Render's `type: pserv` and Railway's no-domain default both mean there is no public route to reach. That is invariant 4, and on a PaaS it is a service-type choice rather than a firewall rule.

## 5. Trusted-proxy hop counts

Per `docs/deploy-ingress.md`, the count must match the real ingress chain.

- **Managed TLS alone is a single hop, so the default `1`** is correct for both `QCMS_PORTAL_TRUSTED_PROXY_HOPS` and `QCMS_ADMIN_TRUSTED_PROXY_HOPS`. The platform's edge writes the client address as the rightmost `X-Forwarded-For` entry; the BFF reads one entry from the right. Set nothing.
- **Behind Cloudflare Access on the admin, bump `QCMS_ADMIN_TRUSTED_PROXY_HOPS` to `2`** for that hostname only: the chain becomes `<client>, <cloudflare-or-platform-edge>` and the app must count two from the right. Setting it higher than the proxies that actually exist makes sign-in throttling forgeable (the resolver reads into client-supplied text); this is the one place a hop-count mistake is a security bug, not an outage.

## 6. Backups

The managed Postgres is your durable state. **Do not rely on the platform snapshot alone** - the same key caveat as every QCMS deployment applies, and the platform cannot back up what is not in the database.

- **Use the platform's managed Postgres backups.** Both offer point-in-time recovery (PITR) on paid database tiers; enable it and confirm the retention window meets your RPO. This replaces the VPS recipe's `pg_dump` cron for the database body.
- **You still owe a key backup, separately.** A restored database is inert without the keys, which live in the service environment, not in the dump: `QCMS_APP_KEY` (webhook secrets, recoverable by re-issuing) and especially `QCMS_ADMIN_AUTH_SECRET` (stored 2FA material, **not** recoverable today - issue #432). Copy `QCMS_APP_KEY`, `QCMS_ADMIN_AUTH_SECRET`, `QCMS_LINK_KEYS`, and `QCMS_SESSION_KEYS` into a separate encrypted store the moment you set them, and keep them somewhere the database backup is not, so one compromise is not both. See `docs/backup-restore.md`.
- Belt and braces: you can still run the `pg_dump` drill from `docs/backup-restore.md` against the managed instance's connection string on a schedule of your own, age-encrypted and shipped off-platform, if you want a copy the platform does not hold.

## 7. Delivery

Both platforms have a native GitHub integration: connect the repo and each push to the tracked branch builds the Dockerfiles and deploys, with the `preDeployCommand` migration running before the new instances serve. That is the simplest path and needs no workflow file.

If you prefer to gate deploys from your own CI (for example, only after `pnpm verify` is green), use a **deploy hook**: both platforms expose a per-service URL you `curl` to trigger a deploy. Documented template, not a live `.github/workflows/` file - the platform is not chosen yet:

```yaml
# DOCUMENTED TEMPLATE - not a live workflow.
name: deploy-paas
on:
  push:
    tags: ["v*"]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      # gate on the real suite first (docs-only PRs excepted)
      - uses: actions/checkout@v7
      # ... pnpm install + pnpm verify ...
      - name: Trigger the platform deploy hook
        run: curl -fsSL -X POST "${{ secrets.DEPLOY_HOOK_URL }}"
        # The platform builds the images and runs the preDeployCommand migration
        # (section 2 / 3) before the new instances take traffic.
```

Note the ordering is the platform's to enforce via `preDeployCommand`; the hook just says "go". Unlike the VPS recipe, there is no push-to-GHCR step here because the platform builds from the Dockerfiles itself. (For context: `.github/workflows/images.yml` builds the three images in CI today but publishes nothing - issue #360.)

## 8. The always-warm caveat

**The API must not scale to zero**, on either platform. It runs the in-process outbox deliverer and the retention sweep on the process that mounts `internal` (here `QCMS_MOUNT=all`). Asleep, it accepts submissions but delivers no webhooks and purges no aged data.

- **Render:** a paid instance (Starter and up) stays always-on; do not put the API on the free tier, which spins down on idle. If you enable autoscaling, set the **minimum instances to at least 1**.
- **Railway:** leave **app sleeping / serverless off** for the API service and set `restartPolicyType: ALWAYS`. Railway does not sleep a service by default, but the serverless setting exists and would break the schedulers if switched on for the API.

The portal and admin may scale more freely; only the API carries the background work, so only the API is bound by this rule.

## 9. Ease and gotchas

**Render - ease: 5/5.** One declarative Blueprint, fixed billing, a real private-service type. The most hands-off way to run QCMS. Top two gotchas:

1. **Don't leave the API on a free/idle-spindown tier.** The schedulers die with the process; use a paid always-on plan and, with autoscaling, a minimum of 1 instance (section 8).
2. **`preDeployCommand` must be on the API service.** It is the only service with `DATABASE_URL`; declared elsewhere it cannot migrate. Confirm it runs before the API cuts over on each deploy.

**Railway - ease: 4/5.** Cheapest at low traffic, config-as-code per service, but the wiring is manual and the bill moves with load. Top two gotchas:

1. **Use `http://` on `RAILWAY_PRIVATE_DOMAIN`, and never generate a public domain for the API.** `https://` breaks the private hop, and a generated domain would put the API on the internet against invariant 4.
2. **Model steady-state RAM before you commit.** Per-second metering is cheap while idle and grows with traffic; an unmodelled busy month can pass the fixed-price Render bill. The API and Postgres are the two to size honestly.

## Related

- `docs/deploy.md` - the index and recommendation this plan sits under.
- `docs/deploy/vps.md` - the single-VPS alternative (Recipe A), for an operator who wants the box.
- `docs/deploy-ingress.md` - the ingress invariants both platforms must satisfy, and the forwarded-address model behind the hop counts.
- `docs/operations.md` - the generated environment reference, health semantics, and the upgrade procedure.
- `docs/backup-restore.md` - the dump, the restore order, the drill, and the key caveat.
