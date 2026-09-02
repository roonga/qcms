# Deploy QCMS on Azure (Container Apps + PostgreSQL Flexible Server)

**Status:** the concrete plan behind [`docs/deploy.md`](../deploy.md). It applies the ingress invariants of [`docs/deploy-ingress.md`](../deploy-ingress.md) (ADR-20, SEC-9) to Azure Container Apps, and it flags one place where the platform cannot satisfy SEC-9 natively - read §3 before you commit to this target.

**Audience:** an operator who already lives on Azure and wants QCMS to look like the rest of what they run. This is the sensible hyperscaler option for QCMS: Container Apps gives you TLS, custom domains, free certificates, an internal-only service, IP restrictions, and scale-to-idle without a load balancer to rent by the hour, so the fixed monthly floor is much lower than the AWS ECS plan ([`docs/deploy/aws.md`](aws.md)). It is still more moving parts than a single VM (`docs/deploy-ingress.md` Recipe A); reach for it when Azure is already your home.

All prices below are approximate **East US** on-demand list, **retrieved 2026-09-01**. **Confirm each at signup** with the Azure pricing calculator for your region: they move, and an AU region runs higher. Azure has a genuine Australia East region if you need data residency; the verified cost map in [`docs/deploy.md`](../deploy.md) (#759, priced from Azure's first-party pricing APIs) prices this deployment in `australiaeast`, where the figures run at the upper end of the range below. Sources are at the foot of the document.

## 1. Service mapping

QCMS is four containers (`docker-compose.yml`). On Azure that becomes three Container Apps in **one Consumption environment**, plus a managed database.

| QCMS component | Azure shape                                                           | Ingress                                                                       | How it stays private                                                                              |
| -------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| portal         | Container App                                                         | **external** ingress, custom domain                                           | public by design (respondent app)                                                                 |
| admin          | Container App                                                         | **external** ingress, custom domain, **`ipSecurityRestrictions` allow rules** | reachable only from the allowlisted source ranges                                                 |
| api            | Container App                                                         | **internal** ingress only (`ingress.external = false`)                        | **has no public endpoint at all** - reachable only by other apps in the environment               |
| postgres       | Azure Database for PostgreSQL Flexible Server, `B1ms`, private access | none                                                                          | VNet-integrated (delegated subnet + private DNS zone), reachable only from the environment's VNet |

The api's privacy is **a platform property here, not a firewall rule you maintain.** With `ingress.external = false`, Azure gives the api an endpoint that resolves only inside the Container Apps environment; there is no public hostname to lock down and nothing to accidentally expose. That is the "API and Postgres are never publicly reachable" property (ADR-20; invariant 4 of `docs/deploy-ingress.md`) delivered by the platform, which is a stronger guarantee than the AWS plan's two-layer security-group fencing.

Point the BFFs at the api by its internal name:

```
QCMS_API_BASE_URL=http://api
```

Apps in the same environment resolve each other by app name; the internal-ingress api answers on plain `http` inside the environment, which is the same private-network hop SEC-9 describes at launch.

### Why this shape and not a simpler one

| Tempting alternative                     | Why it does not fit QCMS                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App Service** (Web App for Containers) | App Service is one public web app per plan and has no first-class notion of a private, internally-addressable third service. To keep the api private you would run it as a **sidecar inside each** of the portal and admin apps - two copies of the one process that owns the database handle and the schedulers - or expose it publicly and re-fence it. Both fight the topology instead of expressing it. |
| **Azure Container Instances** (ACI)      | ACI is bare container hosting with **no ingress features**: no managed TLS, no custom-domain certificates, no IP restrictions, no internal service discovery. You would rebuild everything Container Apps gives you, by hand, in front of it.                                                                                                                                                               |

## 2. Migrate before the api starts

QCMS migration is a deliberate, separate step, never migrate-on-boot (`docs/deploy-enterprise.md` §4). Model it as a **Container Apps Job** of trigger type **Manual**, using the api image with the migrate command:

```sh
az containerapp job create \
  --name qcms-migrate --resource-group qcms --environment qcms-env \
  --trigger-type Manual --replica-timeout 600 --replica-retry-limit 1 \
  --image "$REGISTRY/qcms-api:$TAG" \
  --command "qcms-db-migrate" \
  --secrets ... --env-vars "DATABASE_URL=secretref:migrate-database-url" ...
```

The job's `DATABASE_URL` is the **`qcms_migrate`** credential and the api app's is **`qcms_app`** (SEC-10, issue #492): two secrets, one per role, and the api app never references the migration one. A Container Apps Job fits the split cleanly because it has a secret scope of its own. The role recipe is the "Least-privilege database roles" section of `docs/operations.md`.

The pipeline **starts the job and polls it to `Succeeded` before it updates the api app** (Azure Container Apps has no cross-app ordering primitive, so ordering is the pipeline's job):

```sh
EXEC=$(az containerapp job start --name qcms-migrate --resource-group qcms \
  --query name -o tsv)
while :; do
  STATUS=$(az containerapp job execution show --name qcms-migrate \
    --resource-group qcms --job-execution-name "$EXEC" \
    --query properties.status -o tsv)
  case "$STATUS" in
    Succeeded) break ;;
    Failed|Cancelled) echo "migration $STATUS"; exit 1 ;;
    *) sleep 5 ;;
  esac
done
```

## 3. TLS, and the HSTS gap you must decide first

**Certificates are free and automatic.** Add each custom domain to its app and request an Azure **free managed certificate**; Azure issues and renews it. Portal and admin stay on separate custom domains, which the cookie scoping depends on.

**The gap, and it is real: Container Apps ingress cannot inject response headers.** Its Envoy edge terminates TLS and routes, but it has no way to add a `Strict-Transport-Security` header. So **SEC-9's "HSTS is set at the ingress" (invariant 2 of `docs/deploy-ingress.md`) has no native home on this platform.** Two honest options, and choosing between them is a **Code Owner decision that must be made before an Azure deploy**, because the second one changes the reasoning SEC-9 is built on:

1. **Azure Front Door in front of the two public apps**, with a rule-set action that appends `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`. This keeps HSTS at the edge where SEC-9 wants it, but it adds Front Door's cost and another hop (and, if you also run WAF on Front Door, HSTS is not added to requests WAF blocks).
2. **An environment-gated HSTS header emitted by the two Next apps themselves.** This is a **small code change** - the portal and admin already set `Content-Security-Policy` and the other SEC-9 headers - but it moves one header off the TLS-terminating layer and into the app, which is precisely what SEC-9 argues against ("only the layer that actually terminates TLS can honestly promise it is always available"). It is defensible here because on Container Apps the app **is** always behind the managed-TLS edge, but it is a documented amendment to SEC-9's model, not a free configuration toggle.

Do not ship an Azure deploy with neither. Flag it, get the decision, record it. The api never terminates TLS and never gets a certificate regardless (invariant 1 of `docs/deploy-ingress.md`).

## 4. Secrets and private networking

Roughly eight secrets (`docs/operations.md` is authoritative): `QCMS_INTERNAL_TOKEN`, `QCMS_APP_KEY`, `QCMS_SESSION_KEYS`, `QCMS_LINK_KEYS`, `QCMS_ADMIN_AUTH_SECRET`, the database URL/password, and webhook secrets.

- **Container Apps secrets are free.** Define them per app and reference them from environment variables as `secretref:<name>`. That is the simplest correct option.
- **Key Vault references via a managed identity** are the upgrade when you want central rotation and audit: assign the app a managed identity, grant it `get` on the vault, and reference secrets as Key Vault URIs. QCMS does not require it.
- **Trusted-proxy hops = 1.** The Container Apps Envoy edge is a single hop and appends the client address to `X-Forwarded-For`, so leave `QCMS_PORTAL_TRUSTED_PROXY_HOPS` and `QCMS_ADMIN_TRUSTED_PROXY_HOPS` at their default `1`. If you put Front Door in front (§3), that is a second hop and the count for the fronted hostname becomes `2` - the same reasoning as `docs/deploy-ingress.md`, "The forwarded client address", which is the one ingress mistake that is a security bug, not an outage.
- **Private Postgres via VNet integration, not private endpoints.** Create the environment with a custom VNet (a workload-profiles environment running only the **Consumption** profile still bills at consumption rates), and deploy the Flexible Server with **private access**: a delegated subnet plus a private DNS zone in the same VNet. The apps reach it over its private IP by VNet integration. **Do not** create a **private endpoint on the environment** for this: private endpoints on a Container Apps environment bill as a **Dedicated Plan Management** charge, which defeats the point of the Consumption plan. VNet integration for outbound-to-Postgres does not.

Only one topology fact matters here: a solo `QCMS_MOUNT=all` app owns the schedulers, so keep the api at **min-replicas 1** (see §6) and run one api app. If you later scale the api, split it per `docs/deploy-enterprise.md` and remember the in-memory rate-limit store is **per replica**, so N replicas give N times the configured per-address ceiling until a shared store is added.

## 5. GitHub Actions (OIDC federated credential, no stored keys)

`.github/workflows/images.yml` builds the three images already. A deploy pipeline pushes them, runs the migration job, and updates the apps api-first. Authenticate with a **federated identity credential**: no Azure client secret in GitHub.

```yaml
name: deploy-azure
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  id-token: write # required for OIDC; azure/login mints its token from this
  contents: read

env:
  RG: qcms
  ENV: qcms-env
  REGISTRY: qcmsreg.azurecr.io

jobs:
  build-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }} # ids, not secrets
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
      - name: Build and push all three images
        run: |
          az acr login --name qcmsreg
          for img in api portal admin; do
            docker build -f docker/$img.Dockerfile \
              --build-arg VERSION="$(git describe --tags --always)" \
              -t "$REGISTRY/qcms-$img:${GITHUB_SHA}" .
            docker push "$REGISTRY/qcms-$img:${GITHUB_SHA}"
          done
          # GHCR works too: it is free for this repository. Push to ghcr.io instead
          # and give each Container App a registry credential for it.

  migrate:
    needs: build-push
    runs-on: ubuntu-latest
    steps:
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
      - name: Run migration job and gate on Succeeded
        run: |
          az containerapp job update --name qcms-migrate --resource-group "$RG" \
            --image "$REGISTRY/qcms-api:${GITHUB_SHA}"
          EXEC=$(az containerapp job start --name qcms-migrate --resource-group "$RG" --query name -o tsv)
          while :; do
            S=$(az containerapp job execution show --name qcms-migrate --resource-group "$RG" \
                  --job-execution-name "$EXEC" --query properties.status -o tsv)
            echo "migration: $S"
            case "$S" in
              Succeeded) break ;;
              Failed|Cancelled) exit 1 ;;
              *) sleep 5 ;;
            esac
          done

  deploy:
    needs: migrate
    runs-on: ubuntu-latest
    steps:
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
      - name: Update apps, api first
        run: |
          az containerapp update --name api    --resource-group "$RG" --image "$REGISTRY/qcms-api:${GITHUB_SHA}"
          az containerapp update --name portal --resource-group "$RG" --image "$REGISTRY/qcms-portal:${GITHUB_SHA}"
          az containerapp update --name admin  --resource-group "$RG" --image "$REGISTRY/qcms-admin:${GITHUB_SHA}"
```

**One-time federated-credential setup** (do once, not in the pipeline):

1. Create an app registration (or a user-assigned managed identity) and record its client id, tenant id, and the subscription id. These are **identifiers, not secrets**; storing them as GitHub secrets is convention, not a security requirement.
2. Add a **federated identity credential** on it: issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`, subject `repo:<owner>/<repo>:ref:refs/heads/main` (or a GitHub environment).
3. Assign it roles: `AcrPush` on the registry, and Contributor (or a tighter custom role covering `Microsoft.App/*` for the apps and jobs) on the resource group.

**The subject-claim tripwire.** The federated credential subject is matched **case-sensitively** and character-for-character against the claim GitHub sends. If your owner, repo, branch, or environment name has any uppercase letter, the subject must reproduce it exactly. The portal-generated subject with numeric owner/repo IDs will never match, because GitHub's token does not carry those. When `azure/login` fails with `AADSTS700213: No matching federated identity record found`, read the actual `subject` claim in the run log's "Federated token details" and make the credential match it byte for byte.

## 6. Cost, ease, and the two gotchas

A minimal always-on deployment, East US, list price, **retrieved 2026-09-01, confirm at signup**. Container Apps bills per-second for allocated vCPU and memory, after a monthly free grant per subscription (the first 180,000 vCPU-seconds, 360,000 GiB-seconds, and 2 million requests are free). With every app at `min-replicas 1`, the always-warm allocation - not request volume - sets the floor, and the free grants cover only a fraction of it:

| Line item                                      | Basis                                                         | ~$/mo         |
| ---------------------------------------------- | ------------------------------------------------------------- | ------------- |
| Container App: api (min 1 replica)             | schedulers keep it warm; active + idle mix, after free grants | 18 - 30       |
| Container Apps: portal + admin (min 1 replica) | allocated warm; idle rate with request bursts, after grants   | 14 - 30       |
| PostgreSQL Flexible Server `B1ms` + 32 GB      | ~$12 compute + storage; free for the first 12 months (below)  | 13 - 15       |
| Log Analytics ingestion                        | small                                                         | 0 - 5         |
| **Total**                                      |                                                               | **~$45 - 80** |

**The idle-vs-active caveat, and why the api is the expensive app.** Container Apps bills allocated vCPU and memory at a lower **idle** rate while a replica is running but below its activation threshold, and a higher **active** rate while it is processing. A user-facing app with `min-replicas 1` and little traffic sits mostly at the idle rate. **The api cannot: its in-process schedulers - the outbox deliverer and the retention sweep (`docs/deploy-enterprise.md` §5) - keep it doing work, so it lives between the two rates rather than settling into idle.** That is the price of the schedulers, and it is why the api line is the largest of the three even though it serves no public traffic.

**Cheapest-viable trim:** set portal and admin to **`min-replicas 0`** so they scale to zero when idle (accepting a cold start on the first request after quiet), keep the api at `min-replicas 1` because it must run the schedulers, and take the **DB free year** on a free account. That leaves the api's warm replica plus a free-year database as the whole standing cost, with the free grants absorbing most of the portal/admin bursts. Only with both levers pulled - the free-account DB allowance and portal/admin scaled to zero - does the bill approach **~$22/mo**; the always-warm api undercuts any lower figure, because its schedulers keep it off the idle floor (the caveat above). Once the DB free year ends, or if a warm portal/admin is required, expect the ~$45 - 80/mo range.

**Ease rating: moderate.** Much gentler than the AWS ECS plan - no load balancer, no NAT, no target groups, free certificates - but the VNet-integration-plus-private-DNS setup for Postgres and the federated-credential subject matching are the two places people lose an afternoon.

**Top two gotchas:**

1. **Managed-cert issuance versus an aggressive allowlist.** A free managed certificate is validated by Azure reaching your custom domain over the public internet (a CNAME check and an HTTP validation from DigiCert's addresses). If you apply a tight `ipSecurityRestrictions` allowlist to the admin app **before** its certificate is issued or renewed, the validator cannot reach it and issuance fails silently. Order it: get the domain bound and the certificate issued first, then tighten the allowlist - and remember renewal has the same requirement, so an allowlist that blocks the validator will break a future renewal, not just the first issue.
2. **The HSTS hole (§3).** Container Apps ingress cannot set `Strict-Transport-Security`, so SEC-9's HSTS-at-ingress has no native home. Decide Front Door versus an app-emitted header **before** you deploy, as a Code Owner decision - do not discover it after go-live and ship a topology that quietly drops a security control the other recipes provide.

## Related

- **The ingress invariants and the forwarded-client-address model:** [`docs/deploy-ingress.md`](../deploy-ingress.md).
- **Multi-instance shape and the per-instance rate-limit caveat:** [`docs/deploy-enterprise.md`](../deploy-enterprise.md).
- **Per-variable environment reference and runbooks:** [`docs/operations.md`](../operations.md).
- **The topology decision:** ADR-20, [`docs/PROJECT_GOAL.md`](../PROJECT_GOAL.md) §6; transport and header controls: [`docs/SECURITY_DESIGN.md`](../SECURITY_DESIGN.md) §5 (SEC-9).
- **The AWS ECS plan, for contrast:** [`docs/deploy/aws.md`](aws.md).
- **The deployment index:** [`docs/deploy.md`](../deploy.md) (maintained separately).

## Sources (retrieved 2026-09-01)

- Azure Container Apps pricing and free grants: <https://azure.microsoft.com/en-us/pricing/details/container-apps/>
- Billing in Azure Container Apps (idle vs active rates): <https://learn.microsoft.com/en-us/azure/container-apps/billing>
- Azure Database for PostgreSQL Flexible Server pricing: <https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/>
- Networking and environment types (VNet integration, private endpoints, plan charge): <https://learn.microsoft.com/en-us/azure/container-apps/networking>
- Custom domains and free managed certificates: <https://learn.microsoft.com/en-us/azure/container-apps/custom-domains-managed-certificates>
- Security headers on Container Apps (the response-header limitation and Front Door workaround): <https://techcommunity.microsoft.com/blog/appsonazureblog/implementing-security-headers-in-azure-app-service-and-azure-container-apps/4464250>
- PostgreSQL Flexible Server private access (VNet integration): <https://learn.microsoft.com/en-us/azure/postgresql/network/concepts-networking-private>
- Federated identity credential subject matching (case sensitivity): <https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect>
