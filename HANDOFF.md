# Environment navigation implementation handover

Status: planning complete; runtime implementation not started. No branch freeze or
human-approval hold is asserted by this file.

- Branch: `chore/environment-navigation-poc`.
- Start with [the implementation plan](plan/environment-navigation-implementation.md).
  It covers agreed flows, navigation, existing permissions, gaps, backend contracts,
  sequencing, decisions and acceptance tests.
- Explore [the POC](plan/admin-shell-poc/environment-navigation-poc.html) using
  `pnpm artifacts` and the allocated artifacts port in [PORTS](docs/PORTS.md).
  It uses synthetic data and browser-memory writes, not production APIs.
- **The POC guides flow/UX only. It is not the source of truth for look and feel.**
  Use existing application components and approved visual contracts.
- Read [POC notes](plan/admin-shell-poc/environment-navigation-poc.md) and
  [existing navigation coverage](plan/admin-shell-poc/top-nav-reconciliation.md),
  then apply the implementation plan's audited corrections to mock permissions.
- In particular, global delivery failures and erasure history are installation-only;
  response-only discovery, configurable workflows and atomic multi-target publishing
  need backend work. Ownership does not grant form or response access.
- Runtime audit baseline: `origin/main` at `8dd38ea5`. The earlier independent
  recommendation is historical input; the implementation plan captures later decisions.
- Documentation validation: `pnpm check:plan`, Prettier for this file and
  `git diff --check`. Runtime gates belong to the implementation phases.
- This handover requests no runtime deployment, PR merge or policy broadening.
