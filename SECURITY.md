# Security Policy

> **Pre-release notice.** QCMS is pre-1.0 and unreleased. The pre-launch security
> review has been run (`docs/security-review-2026-08-14.md`) and its sign-off is
> a Code Owner gate that has not yet been given, so QCMS is **not yet suitable
> for production use or for handling real respondent data**. The review document
> records what was verified, what was not, and which findings are still open.

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Report privately through **GitHub Security Advisories**:
[Report a vulnerability](https://github.com/roonga/qcms/security/advisories/new)
(repository -> **Security** tab -> **Report a vulnerability**).

Include the affected component and version, reproduction steps, and the impact
you believe it has. A working proof of concept helps but is not required.

### What to expect

| Stage                                                         | Commitment                                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Acknowledgement                                               | Within **3 business days**                                                   |
| Initial assessment (severity and whether we can reproduce)    | Within **10 business days**                                                  |
| Fix or documented mitigation for a confirmed high or critical | Target **30 days** from confirmation                                         |
| Fix or documented mitigation for a confirmed medium or low    | Target **90 days** from confirmation                                         |
| Public advisory                                               | Published with the fix, crediting the reporter unless anonymity is requested |

QCMS is maintained by a single developer. Those are honest targets rather than a
contractual SLA, and a report that turns out to need an upstream fix will be
paced by the upstream project. If a deadline is going to slip you will be told
rather than left waiting.

### Coordinated disclosure

We ask for coordinated disclosure and will work with you on a timeline before any
public detail. Ninety days from acknowledgement is a reasonable default, shorter
where a fix is already released, longer where an upstream dependency gates it.

### Safe harbour

Testing against **your own deployment** of QCMS, in good faith, is welcome. Do not
test against someone else's instance, do not access or exfiltrate data that is not
yours, and do not run availability attacks. Research conducted within those bounds
will not be pursued.

## Supported versions

| Version                  | Supported                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-1.0 previews (`0.x`) | **No.** Every published package is a preview; APIs, schemas and storage shapes may change without notice, and security fixes are not backported |
| 1.0 and later            | The current minor line receives security patches, released as patch versions with a published advisory                                          |

Once 1.0 ships, security patches are released as patch versions and announced in
the release notes and in a GitHub advisory. Adopters run an owned scaffolded shell
(the shadcn model), so an advisory will state whether the fix lands in a
`@qcms/*` package upgrade or requires a change in the adopter's own shell.

## Scope

**In scope:** the `@qcms/*` packages and the apps in this repository (portal,
admin, api), the `create-qcms-app` scaffold, and the shipped Docker and Compose
artefacts.

**Out of scope** (documented operator responsibility, `docs/SECURITY_DESIGN.md`
§1): host and OS hardening, Postgres server hardening, TLS and ingress
provisioning, VPN configuration, DDoS absorption, backup media custody, and any
vulnerability in an adopter's own modifications to their scaffolded shell.

Findings that amount to "the operator misconfigured it" are in scope only if QCMS
accepted the misconfiguration silently. That has been treated as a real finding
class here, not a deflection.

## Where the security model is written down

- [`docs/SECURITY_DESIGN.md`](docs/SECURITY_DESIGN.md) - threat model, controls
  and the numbered decisions SEC-1 to SEC-13.
- [`docs/security-review-2026-08-14.md`](docs/security-review-2026-08-14.md) -
  the pre-launch review: findings, severities, and an explicit list of what could
  not be verified.
