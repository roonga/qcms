# Security Policy

> **Pre-release notice.** qcms is under active development and has not had its
> pre-launch security review (task 040). It is **not yet suitable for production
> use** or for handling real respondent data. This is the minimal disclosure
> policy for the public pre-release; the full policy ships with the launch
> security review (SEC-12).

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via **GitHub Security Advisories**:
[Report a vulnerability](https://github.com/roonga/qcms/security/advisories/new)
(repo → **Security** tab → **Report a vulnerability**).

Include: affected component/version, reproduction steps, and impact. We aim to
acknowledge within a few business days. Coordinated disclosure is appreciated —
we will work with you on a fix and timeline before any public detail.

## Supported versions

None yet — qcms is pre-1.0 and unreleased. Every published package is a
pre-release preview; APIs, schemas, and storage shapes may change without
notice until 1.0. Security patches are not backported during pre-release.

## Scope

In scope: the qcms packages (`@qcms/*`) and apps (portal, admin, api) in this
repository. Out of scope (documented operator responsibility): host/OS/Postgres
hardening, TLS/ingress, VPN configuration, and DDoS absorption — see
`docs/SECURITY_DESIGN.md` §1.

The security model, threat model, and controls are documented in
[`docs/SECURITY_DESIGN.md`](docs/SECURITY_DESIGN.md) (SEC-1…12).
