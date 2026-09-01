# Deploy QCMS on a single VPS (Recipe A)

**Status:** the concrete, provider-specific plan behind the VPS recommendation in `docs/deploy.md`. It operationalizes **Recipe A** of `docs/deploy-ingress.md` (one VM, the shipped Caddy overlay) and does not restate the invariants there: read that document and `docs/operations.md` first, this one turns them into commands. **Pricing** below is illustrative and was retrieved on **2026-09-01**; confirm the current figure at signup, because every provider here re-prices.

This is one playbook with three provider variants. You run the repo's own Compose stack (`docker-compose.yml`) plus the Caddy TLS overlay (`docker-compose.proxy.yml`) plus a small image-source override, on a single Ubuntu box. The box choice differs per provider; steps 2 through 7 are identical.

## 1. Pick the box

Postgres is the memory-sensitive component here. The three Node images are `node:24-bookworm-slim` multi-stage builds with a small resident footprint; Postgres is what a too-small box starves first. **2 vCPU / 4 GB is the comfortable floor** for portal + admin + api + Postgres + Caddy on one host, with headroom for a `pg_dump` running beside live traffic. 1 GB works for a demo and will swap under load.

| Provider          | Plan              | vCPU / RAM / disk      | Illustrative monthly             | Nearest region to AU                                                                                                       |
| ----------------- | ----------------- | ---------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **DigitalOcean**  | Basic droplet     | 2 vCPU / 4 GB / 80 GB  | ~ $24, flat per region           | **Sydney `SYD1` - the only in-region option here.** Single-digit ms RTT domestically; hosts Basic droplets.                |
| **Hetzner Cloud** | **CX23** (shared) | 2 vCPU / 4 GB / 40 GB  | ~ $7, 20 TB traffic              | **No AU region.** Singapore is the nearest edge; expect ~90-120 ms RTT to Australia from there, more from the EU/US sites. |
| **Hostinger**     | **KVM 2**         | 2 vCPU / 8 GB / 100 GB | ~ $9 promo, **~ $15 on renewal** | **No AU region.** Singapore is the nearest; not an AU-latency option. Promo is first-term only.                            |

**Region first, then price.** Of these three, **only DigitalOcean has an Australian region.** For the AU-based Code Owner and an AU audience, **DigitalOcean's Sydney `SYD1` droplet at ~ $24 is the in-region default recommendation** - it is the only one that keeps respondents on domestic latency. Hetzner's CX23 at ~ $7 is the **cheapest overall** and a fine choice for an EU/global audience or a cost-first test box, but its nearest edge to Australia is Singapore, so accept the added latency if you pick it. Hostinger's KVM 2 gives the most RAM per dollar in year one but is likewise Singapore-nearest, and its renewal is roughly double the promo, so budget for that at month 13. Do not treat Hetzner or Hostinger as AU-latency options; they are not.

Sizing logic: all three clear the 2 vCPU / 4 GB floor, and 4 GB is the number that matters because Postgres needs the RAM. A 1 vCPU / 2 GB box (around $13-15 on DigitalOcean) is a size too small for this stack under any real load, not a cheaper variant of it.

## 2. Prepare the host (Ubuntu 24.04 + Docker CE)

Provision Ubuntu 24.04 LTS, then install Docker CE from Docker's own apt repository (the distro's `docker.io` lags):

```sh
# as root, or with sudo
curl -fsSL https://get.docker.com | sh          # Docker CE + compose plugin
systemctl enable --now docker
mkdir -p /opt/qcms/docker
```

Host firewall: allow inbound **22, 80, 443** (443 also on **udp** for Caddy's HTTP/3), deny the rest. Nothing else needs a public port: the base stack binds portal and admin to `127.0.0.1` and publishes no port at all for `api` and `postgres`.

```sh
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw enable
```

Two DNS records must resolve to the box **before first boot** (Caddy proves control of each name to Let's Encrypt at startup): one for the portal, one for the admin. On a provider security group (DigitalOcean, Hostinger cloud firewall) open the same ports there too.

## 3. Lay out `/opt/qcms`

Put both shipped Compose files and one override on the box. The override is the only new file this recipe introduces; everything else is copied verbatim from the repo.

```
/opt/qcms/
  docker-compose.yml            # from the repo, unchanged
  docker-compose.proxy.yml      # from the repo, unchanged (the Caddy overlay)
  docker-compose.ghcr.yml       # NEW: swaps the local build tags for GHCR image refs
  docker/Caddyfile              # from the repo, unchanged
  .env                          # secrets and config, mode 600, never committed
```

Copy the three tracked files (`docker-compose.yml`, `docker-compose.proxy.yml`, `docker/Caddyfile`) straight from a checkout. The base file builds images tagged `qcms-*:local`; on a server you do not build, you pull. The override replaces those build stanzas with image references published to the GitHub Container Registry by the delivery workflow in section 7.

**`/opt/qcms/docker-compose.ghcr.yml`**

```yaml
# Image-source override for a server that pulls rather than builds. Layer it LAST,
# after docker-compose.yml and docker-compose.proxy.yml. `build: !reset null` drops
# the base file's build stanza so Compose never tries to build on the box; the images
# come from GHCR (published by .github delivery workflow, section 7). `migrate` runs
# the api image, exactly as the base file does.
services:
  migrate:
    image: ghcr.io/OWNER/qcms-api:${QCMS_TAG:-latest}
    build: !reset null
    pull_policy: always
  api:
    image: ghcr.io/OWNER/qcms-api:${QCMS_TAG:-latest}
    build: !reset null
    pull_policy: always
  portal:
    image: ghcr.io/OWNER/qcms-portal:${QCMS_TAG:-latest}
    build: !reset null
    pull_policy: always
  admin:
    image: ghcr.io/OWNER/qcms-admin:${QCMS_TAG:-latest}
    build: !reset null
    pull_policy: always
```

Replace `OWNER` with your GitHub org or user. `QCMS_TAG` pins the release; leave it `latest` only for a test box.

## 4. Write `.env` (mode 600)

The base stack and the Caddy overlay read one `.env`. It carries the secrets, the four public URLs the apps mint links and cookies against, and the three domain values the overlay needs. Generate every secret with a real CSPRNG at 32 characters or more; the API refuses to boot on a placeholder.

```sh
# generate one secret
openssl rand -base64 32
```

```ini
# /opt/qcms/.env   (chmod 600)
# --- secrets: generate each independently, 32+ chars ---
QCMS_DB_PASSWORD=...
QCMS_LINK_KEYS=...
QCMS_SESSION_KEYS=...
QCMS_INTERNAL_TOKEN=...
QCMS_APP_KEY=...
QCMS_ADMIN_AUTH_SECRET=...

# --- public identity (https origins of the two hostnames) ---
QCMS_PORTAL_BASE_URL=https://forms.example.org
QCMS_ADMIN_BASE_URL=https://admin.example.org

# --- Caddy overlay ---
QCMS_PORTAL_DOMAIN=forms.example.org
QCMS_ADMIN_DOMAIN=admin.example.org
QCMS_ACME_EMAIL=ops@example.org

# --- image tag for the GHCR override ---
QCMS_TAG=v1.0.0
```

```sh
chmod 600 /opt/qcms/.env
```

Leave `QCMS_SECURE_COOKIES` and `QCMS_ADMIN_SECURE_COOKIES` **unset**: the images run `NODE_ENV=production`, which marks cookies `Secure`, which is correct behind Caddy's TLS. Setting either to `false` at a non-loopback base URL makes the app refuse to start (issue #292). The full annotated set is in `.env.compose.example`; the authoritative per-variable reference is the generated table in `docs/operations.md`.

## 5. Bring it up

One command, all three files, in order:

```sh
cd /opt/qcms
docker compose \
  -f docker-compose.yml \
  -f docker-compose.proxy.yml \
  -f docker-compose.ghcr.yml \
  up --detach --wait
```

**Every** later command against this stack needs the same three `-f` flags: `down`, `logs`, `ps`, `pull`. The migration ordering is enforced by the Compose dependency graph, not by you sequencing commands: `migrate` waits on `postgres` being `service_healthy`, runs the `qcms-db-migrate` bin once with `restart: "no"`, and `api` declares `depends_on: migrate: condition: service_completed_successfully`. So `api` cannot start until the one-shot migration has exited 0, and `--wait` holds the command until every long-running service passes its healthcheck. There is no migrate-on-boot race because there is exactly one migrator by construction.

Bootstrap the first administrator once the stack is healthy. Put the password in the **invoking shell's** environment and pass `--env` by **name only**, so the value rides the environment rather than the docker CLI's argv, which is world-readable in a `ps` listing (`docs/operations.md`, issue #440). Never put it in `.env`, and never write `--env QCMS_ADMIN_PASSWORD=<value>`.

```sh
# The value is set on the invoking command, and --env forwards it by name only.
QCMS_ADMIN_PASSWORD='the-password' \
docker compose -f docker-compose.yml -f docker-compose.proxy.yml -f docker-compose.ghcr.yml \
  exec --env QCMS_ADMIN_PASSWORD api \
  env QCMS_ADMIN_EMAIL=you@example.org node dist/create-admin.js
```

Prefix the line with a space (or use your shell's equivalent) so the password does not land in shell history.

Verify, per `docs/deploy-ingress.md`:

```sh
curl -sSI https://forms.example.org/  | grep -i strict-transport-security
curl -sSI https://admin.example.org/healthz
curl -sSI http://forms.example.org/   | head -n 1     # 308/redirect to https
```

## 6. TLS and admin restriction

TLS is the shipped Caddy overlay: it terminates HTTPS with automatic Let's Encrypt certificates, sets HSTS at the edge, and routes **only** `portal:3000` and `admin:3000`. `api` and `postgres` publish no host port in `docker-compose.yml` and the overlay adds none, so the API is reachable only by the two BFFs over the internal Docker network. That property is asserted by `scripts/compose-config.test.ts`, not merely documented.

The portal is meant to be public. **The admin must not be.** Three ways to restrict it, in `docker/Caddyfile`, cheapest first:

| Option                | How                                                                                                                                            | Trade-off                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **IP allowlist**      | In the admin site block, gate with `@blocked not remote_ip 203.0.113.0/24 198.51.100.7` and `respond @blocked 403`.                            | Simplest. Needs a stable office/VPN egress IP. No help for a roaming admin.                                       |
| **HTTP basic auth**   | Add `basic_auth { admin <bcrypt-hash> }` to the admin site block (generate the hash with `docker compose ... exec caddy caddy hash-password`). | A second factor in front of the app's own TOTP. Shared credential, coarse; fine as a belt-and-braces gate.        |
| **Cloudflare Access** | Put the admin hostname behind a Cloudflare Access application (SSO / device policy). Caddy then sees Cloudflare, not the admin.                | Best UX for a roaming admin. **Adds a proxy hop:** see section 7 and bump `QCMS_ADMIN_TRUSTED_PROXY_HOPS` to `2`. |

The app already enforces mandatory TOTP (`QCMS_ADMIN_2FA` defaults to `required`) and brute-force throttling on sign-in, so any of these is defence in depth over an already-authenticated surface, not the only lock.

## 7. Trusted-proxy hop counts

Per `docs/deploy-ingress.md`, the hop count must match the real ingress chain or per-address rate limiting is either shared-bucket (too low) or forgeable (too high). For this recipe:

- **Default is `1`** for both `QCMS_PORTAL_TRUSTED_PROXY_HOPS` and `QCMS_ADMIN_TRUSTED_PROXY_HOPS`. Caddy sets `X-Forwarded-For {remote_host}` (replace, not append), so the app sees exactly one entry and it is a fact. A deployment matching this recipe sets nothing.
- **Bump to `2` only for the hostname you put a CDN in front of.** Cloudflare Access on the admin means the admin sees `<client>, <cloudflare>`, so `QCMS_ADMIN_TRUSTED_PROXY_HOPS=2` - **and** you must first configure `trusted_proxies` for Cloudflare's ranges in `docker/Caddyfile` and switch that site's `header_up X-Forwarded-For` to append. Raising the count without the Caddyfile change is the exact bypass `docs/deploy-ingress.md` warns against.

## 8. Backups

Postgres is the only durable state. Follow `docs/backup-restore.md`; the always-forget part is that **a dump is useless without the keys, which are not in it.**

A nightly cron that dumps, age-encrypts, and ships off-box:

```sh
# /etc/cron.d/qcms-backup  (runs 03:15 UTC nightly)
15 3 * * * root cd /opt/qcms && \
  docker compose -f docker-compose.yml -f docker-compose.proxy.yml -f docker-compose.ghcr.yml \
    exec -T postgres sh -c 'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
      --clean --if-exists --no-owner --no-privileges' \
  | age -r age1exampleRECIPIENTkey... \
  > /var/backups/qcms-$(date -u +\%Y\%m\%dT\%H\%M\%SZ).sql.age && \
  rclone copy /var/backups/ r2:qcms-backups/   # or b2:, any off-box target
```

**Back the key material up separately, and to a different place than the dump.** A dump restored beside a different `QCMS_APP_KEY` comes back with every webhook signing secret undecryptable (recoverable by re-issuing each secret), and one restored without the matching `QCMS_ADMIN_AUTH_SECRET` strands every administrator's 2FA (not recoverable today, issue #432). So copy `/opt/qcms/.env` - or at least `QCMS_APP_KEY`, `QCMS_ADMIN_AUTH_SECRET`, `QCMS_LINK_KEYS`, `QCMS_SESSION_KEYS` - into a password manager or a separate encrypted store. Keeping them out of the dump is deliberate (SEC-6); keeping them backed up is on you.

Rehearse the restore: `pnpm qcms:drill-restore` is the assertion that a dump produces a working product, and `docs/backup-restore.md` is the manual drill.

## 9. Delivery workflow (GitHub Actions)

`.github/workflows/images.yml` already **builds** all three images with SBOM and provenance (task 036), but publishes nothing: no deploy pipeline exists yet (issue #360). ADR-20's rule is about the runtime network, not the registry: it says the API publishes **no host port** and is reachable only by the two BFFs on the internal network, which stays true however the image is distributed. Whether to publish the images to a registry at all is a separate distribution decision, still pending Code Owner confirmation (issue #763). This recipe assumes that decision lands as a **private** GHCR image, which is what a server pull needs. Step 0 of wiring delivery is therefore "add push-to-GHCR"; the workflow below does that and then pulls on the box over SSH, keeping `.env` server-side.

This is a documented template, not a live `.github/workflows/` file: the platform is not chosen yet, so committing it would claim a decision the Code Owner has not made.

```yaml
# DOCUMENTED TEMPLATE - not a live workflow. Delivery for the single-VPS recipe:
# build+push three images to GHCR, then pull+up on the box over SSH.
name: deploy-vps
on:
  push:
    tags: ["v*"]
  workflow_dispatch:

permissions:
  contents: read
  packages: write # push to GHCR

jobs:
  images:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        image: [api, portal, admin] # migrate reuses the api image
    steps:
      - uses: actions/checkout@v7
        with: { fetch-depth: 0 }
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: docker/${{ matrix.image }}.Dockerfile
          push: true
          tags: ghcr.io/${{ github.repository_owner }}/qcms-${{ matrix.image }}:${{ github.ref_name }}
          build-args: VERSION=${{ github.ref_name }}

  deploy:
    needs: images
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: deploy
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/qcms
            sed -i 's/^QCMS_TAG=.*/QCMS_TAG=${{ github.ref_name }}/' .env
            docker compose -f docker-compose.yml -f docker-compose.proxy.yml -f docker-compose.ghcr.yml pull
            docker compose -f docker-compose.yml -f docker-compose.proxy.yml -f docker-compose.ghcr.yml run --rm migrate
            docker compose -f docker-compose.yml -f docker-compose.proxy.yml -f docker-compose.ghcr.yml up --detach --wait
```

The secrets (`.env`) never leave the box: the workflow ships only an image tag and an SSH command. Run `migrate` as its own step before `up`, exactly as the upgrade procedure in `docs/operations.md` prescribes, so the new API never serves against an un-migrated schema. Pin `QCMS_TAG` to the tag you built; do not deploy `latest` to production.

## 10. The always-warm caveat

**The API must never scale to zero on any option.** It hosts the in-process outbox deliverer and the retention sweep on the process that mounts `internal` (here, `QCMS_MOUNT=all`). If that process is asleep, submissions are accepted but never delivered to webhooks, and aged sessions and payloads are never purged. On a VPS this is automatic - `restart: unless-stopped` keeps it up - but it is the constraint that shapes the PaaS recipe (`docs/deploy/paas.md`), where scale-to-zero is a setting you must actively refuse.

## 11. Ease and gotchas

**Ease: 3/5.** More moving parts than a PaaS (you own the OS, the firewall, patching, and the backup cron), but every part is the repo's own shipped artifact and the failure modes are local and legible.

Top two gotchas:

1. **DNS must resolve before first `up`.** Caddy fetches certificates at startup by proving control of each name. Bring the box up before the `A`/`AAAA` records propagate and issuance fails, and repeated failures count against the Let's Encrypt rate limit for that name. Check `docker compose ... logs caddy` before retrying.
2. **The three `-f` files are load-bearing on every command.** A `docker compose down` with only the base file leaves Caddy orphaned; a `pull` missing the GHCR override rebuilds from source or fails. Wrap the trio in a shell alias on the box so no command forgets one.

## Related

- `docs/deploy.md` - the index and recommendation this plan sits under.
- `docs/deploy-ingress.md` - Recipe A in full: the invariants, the Caddyfile edge policy, the forwarded-address model.
- `docs/operations.md` - the generated environment reference, health semantics, the upgrade procedure, and key-rotation runbooks.
- `docs/backup-restore.md` - the dump, the restore order, and the drill.
- `docs/deploy/paas.md` - the managed-container alternative for an operator who would rather not own a box.
