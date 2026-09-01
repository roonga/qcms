# QCMS and Cloudflare

**Audience:** an operator who already runs QCMS somewhere (the Fly deploy in `docs/deploy/fly.md`,
or a VM using Recipe A in `docs/deploy-ingress.md`) and wants a free, hardened ingress, access
gate, and backup target in front of it. **Prerequisite reading:** `docs/deploy-ingress.md`,
especially the trusted-proxy hop model and "Stacking another proxy".

This is the concrete plan behind the `docs/deploy.md` platform index (written separately).

**Read this first: Cloudflare is not where the QCMS stack runs.** It is the layer in front of the
host that does. The rest of this document is about that layer. Prices and free-tier limits below are
current as of 2026-09-01 and listed at the foot; **confirm each at signup, they change.**

## Why not run the stack on Cloudflare

Cloudflare Containers reached general availability and can run a container image, so it is fair to
ask whether QCMS could live there directly. It should not, for three concrete reasons, each a
mismatch with what ADR-20's four-container topology needs:

- **No Postgres.** Container disk on Cloudflare is **ephemeral**: when an instance sleeps, its next
  start gets a fresh disk from the image. QCMS's one stateful component cannot live on that, and
  Cloudflare offers no managed Postgres, so the database would have to be external anyway - at which
  point Cloudflare is hosting only the stateless apps, at a worse price than platforms built for it.
- **The sleep model fights the always-warm API.** Cloudflare Containers scale to zero by design and
  sleep after an idle timeout (10 minutes by default). The QCMS API must be always-on because it
  hosts the in-process outbox deliverer and retention sweep (`docs/deploy/fly.md` "the scale-to-zero
  trap"); a platform whose central feature is sleeping is the wrong home for a process that must not.
- **No flat private network.** ADR-20 invariant 4 wants the API reachable only by the two BFFs on a
  private network. Cloudflare's model is public-edge-plus-Workers, not a private mesh between your
  own containers, so reproducing "the API has no public address" takes more effort here than on a
  platform that gives it for free.

A run-the-stack-on-Cloudflare plan is therefore possible but a poor fit at a higher price than Fly,
and this document deliberately does not write one. Reach for Cloudflare as the **layer**, below.

## The recommended pattern: Cloudflare in front of a container host

This is what Cloudflare is genuinely excellent at for QCMS, and all of it fits the free tier for a
solo instance. The origin is your existing deploy (Fly, or a VM); Cloudflare sits in front and adds
ingress hardening, an access gate for the admin, and a backup target.

```
                 respondents                       operator
                     |                                 |
            Cloudflare (proxied DNS,          Cloudflare Access (free =<50 users)
             WAF, DDoS - free plan)                     |
                     |                          cloudflared Tunnel (outbound)
                     v                                 |
              portal origin  <----- your host ----->  admin origin
                (Fly / VM: docs/deploy/fly.md, docs/deploy-ingress.md Recipe A)
                                     |
                              R2 (pg_dump backups, free tier)
```

### Portal: proxied DNS + WAF + DDoS

Put the portal's public hostname on Cloudflare with the **proxied** (orange-cloud) DNS record, on
the free plan. That alone gives you the managed WAF, DDoS protection, and the edge caching in front
of the respondent app, at $0. The origin stays your host; Cloudflare is the front door.

**This changes the hop count. See the critical note below - it is the one way to get this wrong.**

### Admin: Cloudflare Access + a cloudflared Tunnel

ADR-20 places authoring behind "VPN or internal". Cloudflare gives you a browser-native equivalent:

- **Cloudflare Access** gates the admin origin behind your identity provider, free for up to 50
  users. Only an authenticated, authorized person reaches the app.
- **A `cloudflared` Tunnel** from the admin machine dials **out** to Cloudflare and serves the admin
  origin through that outbound connection. This does two things at once: the admin origin needs **no
  public inbound** at all (no open port, no public IP), and it **closes the direct-to-origin bypass**
  that Access alone leaves. Access in front of a publicly reachable origin can be skipped by anyone
  who learns the origin address; a Tunnel means there is no origin address to skip to.

Run the connector on the admin host:

```sh
cloudflared tunnel login
cloudflared tunnel create qcms-admin
# route the admin hostname to the tunnel, point it at the admin app's local port,
# then run the connector (as a service in production):
cloudflared tunnel route dns qcms-admin admin.example.com
cloudflared tunnel run --url http://localhost:7040 qcms-admin
```

`https://admin.example.com` is now a real TLS origin, gated by Access, with nothing exposed on the
host. Set `QCMS_ADMIN_BASE_URL=https://admin.example.com` so better-auth's trusted origin and cookie
scope match what the browser uses. This is the browser-simplest admin restriction referenced from
`docs/deploy/fly.md`; it replaces the private-TLS-over-WireGuard step there.

## Critical: the hop count moves, and both halves must agree

Putting Cloudflare (proxied) in front of your existing ingress adds a proxy to the chain, and QCMS's
per-address rate limiting counts proxies. **Getting this half-right is the documented rate-limit
bypass, not a cosmetic error.**

For a portal fronted by Cloudflare in front of Caddy (Recipe A), you must do **both** of:

1. **Change the Caddyfile.** By default `docker/Caddyfile` sets `X-Forwarded-For {remote_host}`,
   which now reports Cloudflare's egress node, not the respondent. Configure `trusted_proxies` for
   Cloudflare's IP ranges and let Caddy **append** rather than set, so the respondent's address
   survives as a distinct entry. This is exactly the change `docs/deploy-ingress.md` "Stacking
   another proxy" prescribes.
2. **Raise the hop count** to match: `QCMS_ADMIN_TRUSTED_PROXY_HOPS=2` (and/or
   `QCMS_PORTAL_TRUSTED_PROXY_HOPS=2`) per deploy, because the chain is now
   `<client>, <cloudflare>, <caddy-saw>` and the count runs from the right.

**Doing only step 2 is the bypass.** If you raise the hop count without making Caddy trust and append
for Cloudflare's ranges, the entry the app reads is one a client can write, and per-address rate
limiting stops existing with no visible symptom (`docs/deploy-ingress.md`, "What a misconfiguration
gets you": a hop count higher than the real chain is the dangerous one). Doing only step 1 is merely
coarse (everyone behind a Cloudflare node shares a bucket), which is safe. Change both, together.

For a Fly-hosted portal fronted by Cloudflare, the equivalent is `QCMS_PORTAL_TRUSTED_PROXY_HOPS=2`,
because Fly Proxy appends the client address and Cloudflare adds one more hop; `docs/deploy/fly.md`
carries that in its hops table. For the admin behind Access + Tunnel, the connector forwards to the
local app as the one proxy in front of it, so `QCMS_ADMIN_TRUSTED_PROXY_HOPS=1`.

## R2 for backups

If your database is external free-tier Postgres (Path B in `docs/deploy/fly.md`), backups are your
responsibility, and Cloudflare R2 is a clean destination: **zero egress fees**, and a free tier of
10 GB storage plus generous monthly operations - comfortably more than a solo instance's `pg_dump`
history needs, at $0.

R2 speaks the S3 API, so `rclone` is the simplest cron target. Sketch:

```sh
# one-time: configure an rclone remote named r2 for the R2 bucket
#   rclone config  ->  type: s3, provider: Cloudflare,
#   endpoint: https://<account-id>.r2.cloudflarestorage.com, keys from an R2 API token

# nightly, after the pg_dump from docs/backup-restore.md:
pg_dump "$DATABASE_URL" --format=custom --file "qcms-$(date -u +%F).dump"
rclone copy "qcms-$(date -u +%F).dump" r2:qcms-backups/
```

Keep the R2 API token scoped to that one bucket, and prune old dumps with an R2 lifecycle rule or an
`rclone delete --min-age`. The restore side is unchanged: pull the dump back and follow
`docs/backup-restore.md`. Managed Postgres (Path A) makes this optional, since the platform backs up
the database; R2 is still a fine belt-and-braces off-provider copy.

## GitHub Actions: minimal here

Cloudflare is the layer, not the deploy target, so there is little CI to write. The container deploy
pipeline belongs to the underlying host's doc - `docs/deploy/fly.md` carries the build-push-deploy
workflow, and nothing about fronting it with Cloudflare changes that.

A `wrangler` or Cloudflare-API-token step in CI is warranted **only** if you manage the Cloudflare
layer as code: Access policies, WAF rules, DNS records, or a Worker. If you configure Access and the
Tunnel through the dashboard (the common solo path), there is no QCMS CI to add at all. If you do
adopt Access-as-code, store a scoped Cloudflare API token as a GitHub secret and rotate it, the same
discipline the Fly deploy token gets.

## Sources

Retrieved 2026-09-01. Confirm free-tier limits and prices at signup; they change.

- Cloudflare Containers - GA status, ephemeral disk, and the default sleep-after-idle model:
  https://developers.cloudflare.com/containers/ and
  https://developers.cloudflare.com/containers/faq/ and
  https://blog.cloudflare.com/containers-are-available-in-public-beta-for-simple-global-and-programmable/
- Cloudflare Containers pricing (billed on active usage; scale-to-zero):
  https://developers.cloudflare.com/containers/pricing/
- Cloudflare Access / Zero Trust free tier (up to 50 users, $0):
  https://www.cloudflare.com/plans/ and https://developers.cloudflare.com/cloudflare-one/
- Cloudflare Tunnel / `cloudflared` (outbound-only connector, no public inbound needed):
  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
- Cloudflare R2 pricing and free tier ($0 egress; 10 GB storage plus monthly operations free):
  https://developers.cloudflare.com/r2/pricing/
- The QCMS trusted-proxy hop model and "Stacking another proxy": `docs/deploy-ingress.md`.
