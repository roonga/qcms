---
"create-qcms-app": minor
---

Grow the assist slice into an agent slice with a frozen registry of admin screens, a typed
context per screen and one door per screen.

- `apps/api/src/features/agent/` replaces `features/forms/assist/`; the routes and their
  mount flag are unchanged.
- `SCREENS` holds one row per `(shell)` page: a `z.strictObject` facts schema, a context
  builder that checks the screen's own SEC-3 cell before it reads anything, the screen's
  read tools and its action kinds.
- A turn carries a screen id, the route's own ids and the response list's four filters.
  The browser never sends context content.
- `runAgentTool` refuses a name outside the registry and a registered name outside the
  current screen's list, and a tool that declares a cell runs only once the caller is
  shown to hold it.
- `POST /admin/assist` serves a screen with no form in its route and shares the
  per-principal limiter key with the per-form route.
- The response screens read a metadata projection that selects no answer column and joins
  no answer table, and an agent read the screen audits writes one SEC-15 `read` row per
  conversation for each distinct filter set.
