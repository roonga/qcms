# Ingress and TLS

**Status:** authoritative for the two ingress recipes QCMS ships. Decided in **ADR-20**
(`docs/adr/core.md`), constrained by **SEC-9** (`docs/SECURITY_DESIGN.md` §5), and the
routing property is asserted by `scripts/compose-config.test.ts` rather than trusted to this
document.

QCMS runs four containers: the respondent portal, the authoring admin, the API, and Postgres
(`docker-compose.yml`). **None of them terminates TLS**, and no reverse proxy ships as a fifth
standing service. Ingress is operator infrastructure: it is vendor-shaped, adopters already own
one, and keeping it out of the base stack is what lets "the API is never publicly routable" be a
property of the compose file instead of a property of somebody's proxy-configuration discipline.

This document is the two recipes that ADR-20 promises:

- **Recipe A** - a single VM with a public IP, using the optional Caddy overlay this repo ships
  (`docker-compose.proxy.yml` + `docker/Caddyfile`, automatic Let's Encrypt certificates).
- **Recipe B** - a cloud load balancer, written against **ECS + ALB** because that is the shape
  ADR-20 names. The reasoning transfers to any L7 balancer; the attribute names do not.

Pick one. They are alternatives, not layers: on a cloud load balancer you do **not** also run the
Caddy overlay.

## The invariants

Both recipes preserve the same properties. They are the table below, and the rest of this document
refers to them by number.

| #   | Invariant                                                                                                                            | Why, and where it is enforced                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **TLS terminates at the ingress.** The apps speak plain HTTP on a private network and never hold a certificate.                      | ADR-20. The hop from ingress to app is inside the Compose bridge network (Recipe A) or inside the VPC (Recipe B).                                                                                                                                                                                                                                                                                                  |
| 2   | **HSTS is set at the ingress**, not by the apps.                                                                                     | SEC-9. Only the layer that actually terminates TLS can honestly promise it is always available.                                                                                                                                                                                                                                                                                                                    |
| 3   | **Only portal and admin are routed.**                                                                                                | ADR-20. The absence of an API route is the control; see "Verifying the routing property".                                                                                                                                                                                                                                                                                                                          |
| 4   | **The API and Postgres are never publicly reachable.** The API is reachable only by the two BFFs, on the internal network.           | ADR-20. `api` and `postgres` publish no host port in `docker-compose.yml`, and no ingress recipe adds one.                                                                                                                                                                                                                                                                                                         |
| 5   | **The ingress tells the apps the browser-facing scheme is `https`.**                                                                 | Both apps run behind a plain-HTTP hop and would otherwise mint `http://` URLs and mis-scope cookies.                                                                                                                                                                                                                                                                                                               |
| 6   | **The ingress writes an `X-Forwarded-For` whose rightmost entry is the address it accepted the connection from, on both hostnames.** | The ingress is the only component that sees the peer address, and two controls key on what it reports: the API's respondent rate limits and better-auth's per-IP sign-in throttle. See "The forwarded client address" below: a proxy that leaves the header untouched collapses every caller into one bucket, and one that lets a client contribute the entry the apps read hands each caller a bucket of its own. |

Invariant 5 has a second half that is pure configuration and is easy to forget. The two cookie
rows now fail loudly when you get them wrong (the app refuses to start); the two base-URL rows
still do not, so check them by hand:

| Variable                    | Behind an ingress, set it to          | What breaks if you do not                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QCMS_PORTAL_BASE_URL`      | the portal's public `https://` origin | Secure links are minted as `${QCMS_PORTAL_BASE_URL}/l/<token>` (`apps/api/src/features/links/handler.ts`). Left at a local value, every link a respondent receives points at the operator's own loopback.                                               |
| `QCMS_ADMIN_BASE_URL`       | the admin's public `https://` origin  | It is better-auth's base URL and its only trusted origin (the API owns the better-auth instance since task 056). A mismatch fails sign-in, not merely link generation.                                                                                  |
| `QCMS_SECURE_COOKIES`       | leave unset                           | Unset means the image's `NODE_ENV=production` decides, which marks the portal's cookies `Secure`. That is already correct behind TLS. Set to `false` here and the portal **refuses to start**, because the base URL above is not loopback (issue #292). |
| `QCMS_ADMIN_SECURE_COOKIES` | leave unset                           | Unset means the image's `NODE_ENV=production` decides, which marks the admin cookies `Secure`. That is already correct behind TLS. Set to `false` here and the admin **refuses to start**, for the same reason.                                         |

Full annotations for all four are in `.env.compose.example`.

## Recipe A: a single VM, with the Caddy overlay

The shape this recipe is for: one host with a public IP, two DNS names, and no infrastructure to
speak of. The overlay adds exactly one container and one routing policy.

### Prerequisites

- Two DNS records (`A`, plus `AAAA` if the host has IPv6) pointing at the VM: one for the
  respondent portal, one for the authoring admin. They must resolve **before** the first boot,
  because Caddy proves control of each name to Let's Encrypt at startup.
- Inbound 80 and 443 open to the internet on the host firewall and on any cloud security group.
  443 carries the traffic; 80 is needed for the ACME HTTP challenge and for the automatic
  redirect to HTTPS. Caddy also listens on 443/udp for HTTP/3.
- A working solo stack, per the Compose quickstart in [`README.md`](../README.md).

### Configuration

Three variables are **required** by the overlay, with no defaults: `docker compose` refuses to
start if any is missing, rather than booting a half-configured ingress.

| Variable             | Required              | Meaning                                                                                                                                            |
| -------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QCMS_PORTAL_DOMAIN` | yes                   | Public hostname for the respondent portal. Becomes a Caddy site block, and the name on its certificate.                                            |
| `QCMS_ADMIN_DOMAIN`  | yes                   | Public hostname for the authoring admin. Same.                                                                                                     |
| `QCMS_ACME_EMAIL`    | yes                   | The address Let's Encrypt contacts about the account (expiry warnings, policy changes).                                                            |
| `QCMS_CADDY_IMAGE`   | no (`caddy:2-alpine`) | Overridable for the same reason the Postgres image is: an operator mirroring base images into their own registry should not have to fork the file. |

Set them in the same `.env` the base stack reads, alongside the four `*_BASE_URL` and cookie
values from the invariants table above. `QCMS_PORTAL_BASE_URL` and `QCMS_ADMIN_BASE_URL` are the
`https://` forms of the two domains.

### Run it

```sh
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up --detach
```

The overlay is opt-in by construction: it is a second `-f`, so a stack started the plain way
never has it. Every subsequent command against this stack needs both files, including
`down`, `logs`, and `ps`.

### What you get

| What the overlay adds                      | Detail                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One new service                            | `caddy`, `restart: unless-stopped`, waiting on portal and admin `service_healthy` before it starts. An ingress that comes up before its upstreams answers 502 to the first visitor.                                                                                                         |
| The only publicly bound ports in the stack | `80:80`, `443:443`, `443:443/udp`. Bound on all interfaces, unlike everything in the base file: this is the one process whose job is to be publicly reachable.                                                                                                                              |
| Certificates                               | Issued and renewed automatically by Caddy for both names.                                                                                                                                                                                                                                   |
| Two named volumes                          | `qcms-caddy-data` (certificates and the ACME account key) and `qcms-caddy-config`. Named rather than container-lifetime, because losing the account key means re-issuing every certificate on the next boot, and Let's Encrypt rate-limits that. Back the data volume up with the database. |

### The edge policy

`docker/Caddyfile` is the whole routing policy and is deliberately short: two site blocks, two
upstreams (`portal:3000`, `admin:3000`), no snippet indirection on the upstream itself so that
"what is routed" reads top to bottom. A shared `(qcms_edge)` snippet carries what SEC-9 asks of
the edge:

| Directive                                                                  | What it does, and why it lives here                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"` | Invariant 2. Two years, subdomains included, preload-eligible. **Drop `preload`** if any sibling hostname under the same parent domain still serves plain HTTP: preload is a commitment about the whole domain, and it is slow to undo.                                                                                                                                              |
| `-Server`                                                                  | Removes Caddy's version banner. Not information a respondent needs.                                                                                                                                                                                                                                                                                                                  |
| `request_body { max_size 1MB }`                                            | The edge-side match for the API's own `QCMS_BODY_LIMIT_BYTES` cap, so an oversized request is rejected before it crosses into a Node process. Raise both together or neither.                                                                                                                                                                                                        |
| `encode zstd gzip`                                                         | Response compression at the edge.                                                                                                                                                                                                                                                                                                                                                    |
| `header_up X-Forwarded-Proto https` (per site)                             | Invariant 5. The hop to the app is plain HTTP on the bridge network, so nothing else would tell Next the browser-facing scheme.                                                                                                                                                                                                                                                      |
| `header_up X-Forwarded-For {remote_host}` (per site)                       | Invariant 6. **Set, never append.** `{remote_host}` is the peer address the edge can actually vouch for, and setting it discards whatever the client sent, so the chain the app receives is exactly one entry and that entry is a fact. If you put another proxy in front of Caddy, see "Stacking another proxy" below: `{remote_host}` then reports that proxy, not the respondent. |

Caddy redirects HTTP to HTTPS on its own; there is no rule to write for it.

### Verify

```sh
# both names serve HTTPS, with the HSTS header set at the edge
curl -sSI https://$QCMS_PORTAL_DOMAIN/  | grep -i strict-transport-security
curl -sSI https://$QCMS_ADMIN_DOMAIN/healthz

# plain HTTP redirects rather than serving
curl -sSI http://$QCMS_PORTAL_DOMAIN/ | head -n 1
```

If the first certificate does not appear, read `docker compose ... logs caddy` before retrying:
repeated failed issuance counts against the Let's Encrypt rate limit for the name.

## Recipe B: ECS + ALB

The cloud-load-balancer shape. One internet-facing Application Load Balancer, three ECS services,
and one database. Written against ALB because ADR-20 names it; the invariants are what transfer.

### Topology

```
                     internet
                        |
              ALB (internet-facing)
        HTTPS listener 443  ·  HTTP listener 80 -> redirect
                        |
        +---------------+---------------+
        |                               |
   tg-qcms-portal                 tg-qcms-admin
        |                               |
   ECS service: portal          ECS service: admin      <- both plain HTTP on 3000
        \                               /
         \                             /
          +----> ECS service: api <---+                 <- private only, no target group
                        |
                    Postgres (RDS or a container)
```

The API and the database sit on private subnets with no listener rule and no target group. That
is invariant 4, and on this platform it wants two independent layers:

1. **No route.** The ALB has no target group for the API and no listener rule that could select
   one. Nothing about the balancer's configuration can reach it.
2. **No path.** The API service's security group accepts traffic on its container port only from
   the portal and admin task security groups, never from the ALB's. Postgres accepts only from
   the API's.

Portal and admin find the API by internal name: point `QCMS_API_BASE_URL` at its ECS Service
Connect or Cloud Map DNS name over `http://`. That is the same private-network HTTP hop SEC-9
describes at launch, with mTLS documented as the enterprise upgrade.

### Target groups and listener rules

Exactly two target groups, both `HTTP` to the containers' port `3000`:

| Target group | ECS service | Health check path | Why that path                                                                                                                                |
| ------------ | ----------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| portal       | `portal`    | `/`               | The portal's root is a neutral landing page (`apps/portal/app/page.tsx`): credential-free, no database read.                                 |
| admin        | `admin`     | `/healthz`        | A deliberately trivial liveness probe (`apps/admin/app/healthz/route.ts`): credential-free, database-free, revealing no version or build id. |

Both are the same paths the images' own `HEALTHCHECK` instructions use (`docker/portal.Dockerfile`,
`docker/admin.Dockerfile`), which keeps one answer to "is this process serving HTTP" rather than
two that can disagree.

The API's probe is `/ready` (`docker/api.Dockerfile`), and it is a **readiness** check in the real
sense: it reports 503 when the database is unreachable. It belongs to the ECS container health
check, never to a target group, because the API has no target group. Note that **ECS only monitors
the health check declared in the task definition**: a `HEALTHCHECK` baked into the image is
ignored unless the task definition repeats it. Copy the command across when you write the task
definition, or the API's readiness goes unwatched.

Listener rules, and there are only two:

| Listener    | Rule                                 | Action                             |
| ----------- | ------------------------------------ | ---------------------------------- |
| 443 (HTTPS) | `Host` header is the portal hostname | forward to the portal target group |
| 443 (HTTPS) | `Host` header is the admin hostname  | forward to the admin target group  |
| 80 (HTTP)   | default                              | redirect to HTTPS 443, `HTTP_301`  |

Give the HTTPS listener an ACM certificate covering both hostnames. Host-based rules keep the two
apps on separate origins, which is what the cookie scoping in the invariants table assumes; a
path-based split onto one hostname is not a supported layout.

### HSTS at the ALB

**An ALB does not set HSTS on its own.** Invariant 2 is not free here, and there are two honest
ways to satisfy it. Pick one, not both:

1. **The listener attribute.** The ALB supports response header insertion, including
   `routing.http.response.strict_transport_security.header_value`. Set it to the same policy the
   Caddy recipe uses (`max-age=63072000; includeSubDomains; preload`, minus `preload` if any
   sibling hostname still serves plain HTTP). While you are there,
   `routing.http.response.server.enabled` defaults to `true`, which adds `server: awselb/2.0`;
   set it to `false` for the equivalent of Caddy's `-Server`.
2. **A CloudFront distribution or WAF in front**, if one is already in the path, with a response
   headers policy that sets the same value.

One caution that costs a real debugging session. When an ALB response header attribute is
configured, the load balancer **overwrites** the header if the target already set one, and adds it
otherwise. QCMS's apps already set `Content-Security-Policy`, `X-Content-Type-Options`,
`Referrer-Policy` and `frame-ancestors` themselves (SEC-9, delivered by tasks 017/029/031), and
the portal's CSP is nonce-based. So set the HSTS attribute, and **leave the CSP and
`X-Content-Type-Options` attributes empty**: filling them in replaces a per-response policy that
knows the nonce with a static string that does not, and the portal's own scripts stop executing.

### What the ALB does not give you

Two things Recipe A gets from Caddy have no ALB equivalent, and both are worth knowing before you
assume parity:

- **No edge body cap.** The ALB has no configurable request-body ceiling (its 1 MB body limit
  applies to Lambda targets, which QCMS does not use). The enforced ceiling is therefore the API's
  own `QCMS_BODY_LIMIT_BYTES` alone. If you want one at the edge, that is AWS WAF, whose body
  inspection for an ALB is itself capped.
- **No HTTP/3.** ALB serves HTTP/2 and HTTP/1.1; QUIC on 443/udp is not an ALB feature. Put
  CloudFront in front if HTTP/3 matters. Nothing in QCMS depends on it.

## The forwarded client address

Invariant 6, and the one place in this document where an ingress mistake is a **security** bug
rather than an outage. It applies identically to both recipes.

### What the stack does with it

Two controls key on a client address, one per hostname, and **both BFFs resolve it the same way**:

- the API's respondent rate limiters (`QCMS_RL_SESSION_CREATE_MAX`, `QCMS_RL_ANSWERS_IP_MAX`), on
  the address the **portal** resolved and asserted (`QCMS_PORTAL_TRUSTED_PROXY_HOPS`);
- better-auth's per-IP sign-in throttle (SEC-1), on the address the **admin** resolved and asserted
  (`QCMS_ADMIN_TRUSTED_PROXY_HOPS`, issue #374).

R2 makes a BFF the only path to the API, so the address the API acts on is always one a BFF
resolved from its own inbound `X-Forwarded-For` and asserted on an internal header. The API itself
ignores `X-Forwarded-For` entirely, in its own limiters and in better-auth's: it never faces the
internet (invariant 4), so an inbound one there is either absent or attacker-shaped.

`X-Forwarded-For` is not a fact, it is a list of claims, and only the entries a proxy you run wrote
are worth anything. Each proxy on the path appends the address of the peer it accepted the
connection from, so **the rightmost entry was written by the nearest proxy** and everything to its
left is either a farther proxy or text the client chose. Each BFF therefore counts its hop-count
entries **from the right**, and a client padding the left cannot move the result.

### Both recipes need `1`, for different reasons

| Recipe            | What the ingress does                                             | Chain the app sees                     | Why `1` is right                                                                     |
| ----------------- | ----------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| A (Caddy overlay) | `header_up X-Forwarded-For {remote_host}` **replaces** the header | exactly `<client>`                     | Whatever the client sent was discarded; the single entry is the peer Caddy accepted. |
| B (ECS + ALB)     | an ALB **appends** the connection source to whatever arrived      | `<anything the client sent>, <client>` | The forged prefix is ignored because the count runs from the right.                  |

`1` is the default for both variables, so a deployment matching either recipe sets nothing. The
recipes front the two hostnames identically (`docker/Caddyfile` carries the same `header_up` pair
in the portal site block and the admin site block), which is why the same answer is right for both.
They are two variables rather than one because they describe two hostnames: put a CDN in front of
the admin only, and only the admin's count moves. Recipe B needs no ALB
attribute change: leave `routing.http.xff_header_processing.mode` at its `append` default. Setting
it to `preserve` breaks this (the client's own header reaches the app untouched, and the rightmost
entry becomes a client-chosen value); `remove` also breaks it, by leaving no address at all.

### Stacking another proxy

A CDN or WAF in front of the ingress is the case that needs a decision, and the two halves have to
agree:

- **Recipe A.** Caddy's `{remote_host}` is the address of _its_ peer, which is now the CDN's egress
  node, so every respondent behind that node shares a bucket. That is safe but coarse. To see past
  it you must change `docker/Caddyfile`: configure `trusted_proxies` for the CDN's ranges and let
  Caddy append rather than set, **and then** raise the hop count to `2`. Doing only the second half
  is the bypass this whole section exists to prevent. Raise the variable for the hostname you
  changed: `QCMS_PORTAL_TRUSTED_PROXY_HOPS`, `QCMS_ADMIN_TRUSTED_PROXY_HOPS`, or both if the CDN
  fronts both.
- **Recipe B.** CloudFront in front of the ALB gives `<client>, <cloudfront>` after the ALB
  appends, so `2` is correct once you have satisfied yourself that CloudFront replaces rather than
  forwards a client-supplied header.

### What a misconfiguration gets you

Read "respondent" as "admin" and "rate limit" as "sign-in backoff" for the admin hostname: the
mechanism is identical, and the consequence is worse, because the control being weakened is the one
protecting authentication.

| Mistake                                                                     | Result                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hop count **higher** than the proxies that actually exist                   | **The dangerous one.** The BFF reads into client-supplied text, so a caller picks its own bucket and per-address rate limiting stops existing. Nothing in the stack can detect this: the chain looks the same either way.                                                                          |
| Hop count **lower**                                                         | Safe but coarse. Callers are bucketed by a proxy's egress address, so a shared NAT or CDN node can exhaust a bucket for everyone behind it.                                                                                                                                                        |
| `0`                                                                         | No forwarded header is trusted; every caller on that hostname shares one bucket. Deliberate, and equivalent to running with no ingress.                                                                                                                                                            |
| Ingress leaves `X-Forwarded-For` untouched                                  | No proxy-written entry exists, so nothing is vouched for and the limits become whole-deployment ceilings. At the default that is 20 session starts per hour for the entire deployment, and three sign-in attempts per ten seconds across every admin.                                              |
| App reachable **directly**, hop count left at `1`                           | The same as "hop count too high", with one hop: there is no proxy, so the only entry in the chain is one the client wrote. Set `0`. Note that no recipe here exposes either app directly, and the base Compose file binds both to loopback (`QCMS_BIND_ADDRESS`) for exactly this class of reason. |
| Ingress **appends** where this document says set, with no `trusted_proxies` | Same as "hop count too high": the entry the BFF reads is one the client wrote.                                                                                                                                                                                                                     |

### Privacy

A client address is personal data. It is used as a rate-limit bucket key and nothing else: it is
not logged, not exported as a span attribute (SEC-13 telemetry is an allowlist and no entry names
an address; HTTP header capture is off in both apps), not returned to a browser, and never
persisted by the respondent limiters. The one place it is stored is the `session` row better-auth
writes when an admin signs in, which is a sign-in audit record and predates this model; what
changed with issue #374 is that the stored value is one the deployment vouched for rather than one
the browser asserted.

## Verifying the routing property

Invariants 3 and 4 hold today by inspection, and inspection is exactly what stops happening the
moment a hurried operator adds `ports:` to the `api` service to debug something and never takes it
out again. So they are asserted: **`scripts/compose-config.test.ts`**, eleven tests in the
`tooling` Vitest project, is exit criterion 5 of task 036.

```sh
pnpm exec vitest run --project tooling scripts/compose-config.test.ts
```

Two design choices in it are worth knowing when you extend either recipe:

- It shells out to `docker compose config`, so Compose's own interpolation and overlay-merge rules
  produce the document under test. The property asserted is "`api` publishes nothing **after**
  `docker-compose.proxy.yml` is layered on", not "neither file mentions a port for `api`".
- The Caddyfile's upstreams are read as text and checked as a **whitelist**: exactly
  `["admin:3000", "portal:3000"]`, and the policy (comments stripped first) never contains `api:`
  or `postgres:`. A third upstream fails whatever it points at, which is the shape that catches
  `reverse_proxy api:3000` being added "just for a health probe".

Recipe B has no equivalent automated gate, because the topology lives in the operator's
infrastructure code rather than in this repo. The two review questions are the same ones the test
asks: does any listener rule reach the API, and does any security group let the balancer reach it.

## The loopback publishes the overlay leaves in place

Layering the overlay does not remove the host publishes the base file makes for portal and admin:
`docker-compose.yml` binds each of them to `${QCMS_BIND_ADDRESS:-127.0.0.1}` on a stable port from
`docs/PORTS.md`, and the overlay adds Caddy beside them rather than replacing them.

That is deliberate, and it is safe: a loopback publish is reachable only from the VM itself, which
is a useful door for `curl` during an incident, and Caddy reaches both apps over the Compose
network rather than through it. `scripts/compose-config.test.ts` asserts that `caddy` is the only
service in the merged configuration bound outside loopback.

**The rule that matters: leave `QCMS_BIND_ADDRESS` at its `127.0.0.1` default when you use the
overlay.** Setting it to `0.0.0.0` puts both apps on the public interface in plain HTTP, beside
the TLS ingress you just installed, and past any host firewall that filters only the INPUT chain
(Docker's forwarding rules sit ahead of it). The one deployment that wants `0.0.0.0` is the
opposite of this recipe: a separate ingress host reaching these containers across a private
network, which is Recipe B's shape, not Recipe A's.

If you want the loopback publishes gone anyway, Compose's `!reset` tag in an override file is the
mechanism (`ports: !reset []`). The overlay does not do it, because the loopback door is worth
more than its removal buys.

## Related

- Which platform to run a recipe on, what it costs, and the invariants a platform with no VM has
  to reproduce for itself: [`docs/deploy.md`](deploy.md).
- **ADR-20** and the operability budget: `docs/adr/core.md` and `docs/PROJECT_GOAL.md` §7.
- **SEC-9** (transport and browser security), plus the body-limit and header controls the edge
  mirrors: `docs/SECURITY_DESIGN.md` §5.
- The multi-instance deployment, where the API is split by mount and the admin sits behind a VPN:
  `docs/deploy-enterprise.md`.
- Port allocation, which is the only place QCMS port numbers are written down. The ingress owns
  the standard web ports 80 and 443, which are not QCMS allocations: [`docs/PORTS.md`](PORTS.md).
- The base stack and its quickstart: [`README.md`](../README.md), `docker-compose.yml`,
  `.env.compose.example`.
