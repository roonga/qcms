# Deploy QCMS on AWS (ECS Fargate + RDS)

**Status:** the concrete plan behind [`docs/deploy.md`](../deploy.md), and the actionable expansion of **Recipe B** in [`docs/deploy-ingress.md`](../deploy-ingress.md) (ECS + ALB). Read that first: this document adds the pipeline, the task definitions, the secrets, and the bill, but the ingress invariants, the HSTS-at-ALB rule, and the trusted-proxy-hop reasoning live there and are not repeated in full.

**Audience:** an operator who already runs on AWS, has an infrastructure-as-code habit, and wants QCMS on ECS. Be honest with yourself before you start: **this is the enterprise trajectory, and it is overkill for a solo launch.** Roughly two-thirds of the monthly bill is the load balancer, the public IPv4 rent, and log ingestion, none of which is compute. If you are one person shipping one questionnaire, a single VM with the Caddy overlay (`docs/deploy-ingress.md` Recipe A) or a Fly.io / VPS recipe is cheaper and simpler by a wide margin. Come here when an organization already lives on ECS and wants QCMS to look like everything else it runs.

All prices below are US East (N. Virginia) on-demand list, **retrieved 2026-09-01**. They move; **confirm each at signup** with the AWS pricing calculator for your region. Sources are listed at the foot of the document.

## 1. Service mapping

QCMS is four containers (`docker-compose.yml`): the respondent **portal** (public), the authoring **admin** (restricted), the **api** (private, the only process with a database handle), and Postgres. On ECS that becomes three Fargate services behind one ALB, plus RDS.

| QCMS component | AWS shape                                                     | Routing                                                                                                                                   | Network fencing                                                                                                                                             |
| -------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| portal         | ECS Fargate service                                           | ALB HTTPS listener rule, `Host` = portal hostname, forward to `tg-qcms-portal`                                                            | task SG accepts `3000` from the ALB SG only                                                                                                                 |
| admin          | ECS Fargate service                                           | ALB HTTPS listener rule, `Host` = admin hostname, **plus an IP-allowlist condition** (`source-ip` on the rule) forward to `tg-qcms-admin` | task SG accepts `3000` from the ALB SG only                                                                                                                 |
| api            | ECS Fargate service                                           | **no target group, no listener rule**                                                                                                     | task SG accepts `3000` from the **portal and admin task SGs only**, never from the ALB SG. Reached by name over ECS **Service Connect** (`http://api:3000`) |
| postgres       | RDS PostgreSQL 16, `db.t4g.micro`, single-AZ, private subnets | none                                                                                                                                      | DB SG accepts `5432` from the api task SG only                                                                                                              |

This is invariant 4 of `docs/deploy-ingress.md` expressed on AWS, and it wants **two independent layers**, because either alone is a single point of failure:

1. **No route.** The ALB has no target group for the api and no listener rule that can select one. Nothing about the balancer's configuration can reach it.
2. **No path.** The api's security group admits the portal and admin task security groups and nothing else; the ALB's own security group is not on that list. A listener rule added by mistake still cannot reach the api, and an SG opened by mistake still has nothing routing to it.

Point `QCMS_API_BASE_URL` at the api's Service Connect DNS name over `http://` (`http://api:3000`). That is the same private-network plain-HTTP hop SEC-9 describes at launch; mTLS is the documented enterprise upgrade, not a launch requirement.

### Why this shape and not a simpler one

| Tempting alternative                    | Why it does not fit QCMS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App Runner** for the two web apps     | App Runner does not forward the request source IP to a **private** service that is associated with a WAF web ACL, so WAF IP-allow rules on it silently do nothing (AWS documents this limitation). The admin surface is defined by an IP allowlist, so the one control you most need is the one that breaks. App Runner also fits "one public service" far better than "two public hostnames plus one private api", and it is **closed to new customers as of 2026-04-30**.                                   |
| **Lightsail** containers                | Lightsail cannot express the topology: two public hostnames with different access policies **and** a third service that must stay private and unroutable. It gives you a public endpoint per service, which is exactly the property ADR-20 forbids the api from having.                                                                                                                                                                                                                                       |
| **Aurora Serverless v2** instead of RDS | Its scale-to-zero auto-pause is the whole reason to reach for it, and QCMS defeats it. The api runs in-process background schedulers - the outbox deliverer and the retention sweep (`docs/deploy-enterprise.md` §5) - which keep issuing queries, and internal database activity of that kind prevents an Aurora Serverless v2 instance from pausing to zero ACU. You would pay the floor continuously and get nothing for the added complexity. `db.t4g.micro` is cheaper and honest about being always-on. |

## 2. Migrate before the api starts

QCMS migration is a **deliberate, separate step**, never migrate-on-boot (`docs/deploy-enterprise.md` §4): a boot-time migration across N api tasks is N racing migrators. Compose enforces the order with `depends_on: service_completed_successfully`. **ECS has no `depends_on` across services**, so the ordering is the pipeline's job, not the platform's.

The migration runs the api image with a command override:

```sh
aws ecs run-task \
  --cluster qcms \
  --task-definition qcms-migrate \
  --launch-type FARGATE \
  --network-configuration "$SUBNETS_AND_SG" \
  --overrides '{"containerOverrides":[{"name":"migrate","command":["node","node_modules/@qcms/db/dist/migrate.js"]}]}' \
  --started-by "gha-${GITHUB_RUN_ID}"
```

Then **wait for it to stop and check the exit code before deploying the api service**. A `run-task` that starts is not a migration that succeeded:

```sh
aws ecs wait tasks-stopped --cluster qcms --tasks "$TASK_ARN"
CODE=$(aws ecs describe-tasks --cluster qcms --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' --output text)
[ "$CODE" = "0" ] || { echo "migration failed (exit $CODE)"; exit 1; }
```

The `qcms-migrate` task definition is the api image with the same secrets and `DATABASE_URL` as the api service, and no schedulers (it exits). It is the ECS twin of the `migrate` one-shot in `docker-compose.yml`.

## 3. TLS at the ALB

This is Recipe B of `docs/deploy-ingress.md`; the rules there are binding. In brief:

- **ACM certificate** covering both hostnames, attached to the **443 HTTPS listener**. Host-based listener rules keep portal and admin on separate origins, which the cookie scoping depends on. A path-based split onto one hostname is not supported.
- **HTTP 80 listener** with a single default rule: redirect to HTTPS 443, `HTTP_301`.
- **HSTS at the ALB**, because an ALB does not set it on its own: set `routing.http.response.strict_transport_security.header_value` to `max-age=63072000; includeSubDomains; preload` (drop `preload` if a sibling hostname still serves plain HTTP). Set `routing.http.response.server.enabled = false` to drop the `server: awselb/2.0` banner.
- **Leave the CSP and `X-Content-Type-Options` ALB attributes empty.** The apps set those themselves and the portal's CSP is nonce-based; an ALB static override replaces the per-response policy that knows the nonce and the portal's own scripts stop executing. This is the debugging session `docs/deploy-ingress.md` warns about.
- **The api never gets a listener.** It terminates no TLS and holds no certificate. Only portal and admin are routed (invariant 3).

## 4. Secrets

Roughly eight secrets (`docs/operations.md` is the authoritative per-variable reference): `QCMS_INTERNAL_TOKEN`, `QCMS_APP_KEY`, `QCMS_SESSION_KEYS`, `QCMS_LINK_KEYS`, `QCMS_ADMIN_AUTH_SECRET`, the database URL/password, and webhook secrets.

- **Store them in SSM Parameter Store as `SecureString`.** Standard parameters are **free**; this is the cheapest correct option on AWS and needs no extra service. (Secrets Manager works too and adds rotation, at ~$0.40 per secret per month; QCMS does not require it.)
- **Inject them through the task definition `secrets:` block**, which maps a parameter ARN to an environment variable at task start. Do not bake secrets into the image or into `environment:`.
- **Grant the execution role** `ssm:GetParameters` on those parameter ARNs and `kms:Decrypt` on the key that encrypts them (the AWS-managed `aws/ssm` key needs no policy of its own; a customer-managed key needs a grant). Non-secret values (`QCMS_PORTAL_BASE_URL`, `QCMS_MOUNT=all`, `PORT=3000`) stay in plain `environment:`.
- **Trusted-proxy hops = 1.** The ALB **appends** the connection source to `X-Forwarded-For`, so leave `QCMS_PORTAL_TRUSTED_PROXY_HOPS` and `QCMS_ADMIN_TRUSTED_PROXY_HOPS` at their default `1`, and leave `routing.http.xff_header_processing.mode` at its `append` default. The full reasoning, and what a wrong hop count costs, is in `docs/deploy-ingress.md`, "The forwarded client address". It is the one ingress mistake that is a security bug rather than an outage.

Because a solo `QCMS_MOUNT=all` process owns the schedulers, only one topology fact matters here: run **one** api service if you keep `all`; if you scale the api, split it per `docs/deploy-enterprise.md` (public tasks scale freely, the `internal`-mounted task stays a singleton) and remember the in-memory rate-limit store is **per task**, so N api tasks give N times the configured per-address ceiling until a shared store is added.

## 5. GitHub Actions (OIDC, no stored keys)

`.github/workflows/images.yml` already builds the three images with SBOM and provenance but does not push or deploy. A deploy pipeline adds push, the migration gate, and an api-first rolling deploy. Authenticate with **OIDC**: no long-lived AWS keys in GitHub.

```yaml
name: deploy-aws
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  id-token: write # required for OIDC; without it configure-aws-credentials cannot mint a token
  contents: read

env:
  AWS_REGION: us-east-1
  ECR_REGISTRY: 111122223333.dkr.ecr.us-east-1.amazonaws.com
  CLUSTER: qcms

jobs:
  build-push:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        image: [api, portal, admin]
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::111122223333:role/qcms-deploy
          aws-region: ${{ env.AWS_REGION }}
      - uses: aws-actions/amazon-ecr-login@v2
      - name: Build and push ${{ matrix.image }}
        run: |
          docker build -f docker/${{ matrix.image }}.Dockerfile \
            --build-arg VERSION="$(git describe --tags --always)" \
            -t "$ECR_REGISTRY/qcms-${{ matrix.image }}:${GITHUB_SHA}" .
          docker push "$ECR_REGISTRY/qcms-${{ matrix.image }}:${GITHUB_SHA}"
      # GHCR is a supported alternative: it is free for this repository and needs no
      # ECR at all. Swap the ecr-login step for docker/login-action against ghcr.io
      # and give the ECS execution role a pull secret instead of ECR permissions.

  migrate:
    needs: build-push
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::111122223333:role/qcms-deploy
          aws-region: ${{ env.AWS_REGION }}
      - name: Run migration and gate on its exit code
        run: |
          TASK_ARN=$(aws ecs run-task --cluster "$CLUSTER" \
            --task-definition qcms-migrate --launch-type FARGATE \
            --network-configuration "$NETWORK_CONFIG" \
            --overrides '{"containerOverrides":[{"name":"migrate","command":["node","node_modules/@qcms/db/dist/migrate.js"]}]}' \
            --query 'tasks[0].taskArn' --output text)
          aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"
          CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
            --query 'tasks[0].containers[0].exitCode' --output text)
          echo "migration exit code: $CODE"
          [ "$CODE" = "0" ] || exit 1

  deploy:
    needs: migrate
    runs-on: ubuntu-latest
    strategy:
      max-parallel: 1 # api MUST reach its new schema before the BFFs roll onto it
      matrix:
        service: [api, portal, admin] # ordered: api first
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::111122223333:role/qcms-deploy
          aws-region: ${{ env.AWS_REGION }}
      - name: Render task definition for ${{ matrix.service }}
        id: render
        uses: aws-actions/amazon-ecs-render-task-definition@v1
        with:
          task-definition: deploy/ecs/qcms-${{ matrix.service }}.json
          container-name: ${{ matrix.service }}
          image: ${{ env.ECR_REGISTRY }}/qcms-${{ matrix.service }}:${{ github.sha }}
      - name: Deploy ${{ matrix.service }}
        uses: aws-actions/amazon-ecs-deploy-task-definition@v2
        with:
          task-definition: ${{ steps.render.outputs.task-definition }}
          service: qcms-${{ matrix.service }}
          cluster: ${{ env.CLUSTER }}
          wait-for-service-stability: true
```

**One-time IAM OIDC trust setup** (do once, not in the pipeline):

1. Create the GitHub OIDC identity provider in IAM: provider URL `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`.
2. Create the `qcms-deploy` role with a trust policy whose condition pins `token.actions.githubusercontent.com:sub` to `repo:<owner>/<repo>:ref:refs/heads/main` (or to a GitHub Actions environment), so only this repository's `main` can assume it.
3. Give the role the permissions the pipeline uses: ECR push/pull, `ecs:RunTask`/`DescribeTasks`/`UpdateService`/`RegisterTaskDefinition`, and `iam:PassRole` for the ECS **execution** and **task** roles (scoped to those two role ARNs, not `*`). The execution role separately gets `ssm:GetParameters` and `kms:Decrypt` from §4.

## 6. Cost, ease, and the two gotchas

A minimal always-on deployment, US East, list price, **retrieved 2026-09-01, confirm at signup**:

| Line item                     | Basis                                             | ~$/mo         |
| ----------------------------- | ------------------------------------------------- | ------------- |
| ALB (base)                    | $0.0225/hr                                        | 16            |
| ALB (LCU, light traffic)      | $0.008/LCU-hr                                     | 6 - 12        |
| Public IPv4 addresses         | $0.005/hr each (ALB interfaces + task public IPs) | 11 - 18       |
| CloudWatch Logs               | $0.50/GB ingest + $0.03/GB-mo                     | 4 - 6         |
| **Non-compute subtotal**      | **the edge and the plumbing**                     | **~$45**      |
| Fargate: portal + admin + api | small tasks, always on                            | 21 - 30       |
| RDS `db.t4g.micro` + storage  | $0.016/hr + gp3                                   | 13 - 15       |
| **Total**                     |                                                   | **~$66 - 79** |

The honest headline: **~$45 of that is the ALB, the public IPv4 rent, and log ingestion - none of it compute.** You pay it whether the questionnaire serves ten responses a month or ten thousand. That is the number to weigh against a $5 - 12/mo VPS running the same four containers.

**Cheapest-viable trims:**

- **Graviton / ARM Fargate.** Rebuild the images for `arm64` and set the task CPU architecture to `ARM64`: about 20% off the compute line for no behaviour change. The base images are `node:24-bookworm-slim`, which is multi-arch.
- **No NAT gateway.** The textbook "enterprise" pattern puts the tasks in private subnets and adds a NAT gateway so they can pull from ECR and reach webhooks and `api.pwnedpasswords.com` - that is **~$33/mo plus data processing**, on its own more than QCMS's entire compute bill. Avoid it: run the tasks in **public** subnets with a security group that **denies all inbound** except the ALB SG (and, for the api, the two BFF SGs). The ALB still reaches them by SG rule, and outbound egress goes through the task's own public IP. The deny-inbound SG is what keeps a public subnet safe. (VPC endpoints for ECR and SSM are the alternative if you are required to keep private subnets.)
- **Ship logs to shorter retention** or to a cheaper sink if the CloudWatch line grows.

**Ease rating: hard.** Not because any one piece is exotic, but because a correct deployment is an ALB, two target groups and three listener rules, three ECS services, Service Connect, four security groups, an RDS instance, ACM, SSM parameters, two IAM roles, and an OIDC pipeline - and several of those are load-bearing for security, not just for uptime. Budget infrastructure-as-code and a day, not an afternoon.

**Top two gotchas:**

1. **The networking cost trap.** The instinct to "do it properly" with private subnets and a NAT gateway roughly doubles the non-compute bill for a workload that does not need it. Decide the subnet-and-NAT question before you build, not after the first invoice.
2. **ECS does not inherit two things Compose gives you for free.** First, **ECS ignores the image's `HEALTHCHECK`**: the api's `/ready` probe (which returns 503 when the database is unreachable) must be **re-declared in the task definition** or the api's readiness goes unwatched, and the portal/admin container health checks likewise (`docs/deploy-ingress.md` states this). Second, **there is no `depends_on`**: the migrate-before-api ordering is the pipeline's responsibility (§2), and skipping the exit-code gate deploys an api against an un-migrated database.

## Related

- **Recipe B, in full:** [`docs/deploy-ingress.md`](../deploy-ingress.md) - the ALB, the listener rules, HSTS, and the forwarded-client-address security model this document builds on.
- **Multi-instance shape:** [`docs/deploy-enterprise.md`](../deploy-enterprise.md) - splitting the api by `QCMS_MOUNT`, the scheduler singleton, and the per-instance rate-limit caveat.
- **Per-variable environment reference and runbooks:** [`docs/operations.md`](../operations.md).
- **The topology decision:** ADR-20, [`docs/PROJECT_GOAL.md`](../PROJECT_GOAL.md) §6.
- **The deployment index:** [`docs/deploy.md`](../deploy.md) (maintained separately).

## Sources (retrieved 2026-09-01)

- AWS Fargate pricing: <https://aws.amazon.com/fargate/pricing/>
- Elastic Load Balancing pricing: <https://aws.amazon.com/elasticloadbalancing/pricing/>
- Amazon RDS pricing: <https://aws.amazon.com/rds/postgresql/pricing/>
- Public IPv4 address and NAT gateway pricing (Amazon VPC pricing): <https://aws.amazon.com/vpc/pricing/>
- Amazon CloudWatch (Logs) pricing: <https://aws.amazon.com/cloudwatch/pricing/>
- App Runner WAF and private-service source-IP limitation: <https://docs.aws.amazon.com/apprunner/latest/dg/network-pl.html>
- Aurora Serverless v2 scaling to zero and what prevents auto-pause: <https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html>
</content>

</invoke>
