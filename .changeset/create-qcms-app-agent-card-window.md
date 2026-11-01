---
"create-qcms-app": patch
---

The scaffolded action card counts its waiting window from arrival (task 083).

Templates are generated from `apps/`, so this is the same edit the repository's own admin
carries, regenerated with `pnpm qcms:sync-templates`. For an adopter it changes when a card
stops being confirmable:

- the window's length comes from the proposal and is counted on a monotonic clock from the
  card's arrival, so an administrator whose device clock is out no longer sees every card
  arrive expired;
- a waiting card ticks itself into "Expired - ask again" with Confirm disabled once that
  window runs out;
- the API is unchanged and still refuses a stale token on its own clock.
