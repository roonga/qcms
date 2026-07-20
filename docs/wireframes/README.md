# Wireframes - format spec (binding)

**Status:** Drafted 2026-07-19 in the plan bundle, ahead of execution (per owner decision). Every file is **Draft (pre-027)** until task 042 verifies it against the frozen API contracts and records sign-off. Task 001 copies this folder to `docs/wireframes/` in the repo.

## The one rule

**The ASCII sketch is illustrative; the inventories are normative. No requirement may live only in box geometry.** An agent (or human) must be able to build the screen from the Regions/States/Interactions inventories alone - the sketch exists for at-a-glance IA review, nothing more. Models parse labeled containment reliably and pixel-ish geometry unreliably; this rule makes the format robust to whichever model executes a UI task.

## File structure

Each wireframe file contains, in order:

1. **Header** - status (`Draft (pre-027)` → `Signed off <date>`), consuming task(s), the API slices it renders.
2. **ASCII sketch** - main screen(s) only; ≤2 nesting levels; every region labeled. Simple screens (dialogs, error pages) may be inventory-only.
3. **Regions (normative)** - a containment tree. Every interactive element names its **real a2ra registry component** (`table`, `dialog`, `menu`, `tabs`, `text-field`, `number-field`, `date-picker`, `radio`, `select`, `checkbox`, `switch`, `button`, `card`, `alert`, `tag`, `breadcrumb`, `popover`, `tooltip`, `accordion`, `text`, `form`, `layout`). A needed component absent from the registry is marked **`[upstream gap]`** - a cross-repo issue per ADR-22, never an invention.
4. **States (normative)** - enumerated screen states (empty / loading / error / etc.). Each must be reachable in the fixtures or seed data so the static-render screenshot set can cover it.
5. **Interactions** - action → API call (slice task number) → UI consequence. API paths must match the 027 OpenAPI documents at 042 verification time.
6. **A11y notes** - focus targets, `aria-live` announcements, keyboard paths. These feed 030's policies; flow-level only (component-level a11y is upstream's, ADR-22).
7. **Sign-off line** - `Signed off: <name>, <date>` - added by 042, absent until then.

## Known upstream component gaps (running list - ADR-22 cross-repo issues)

| Needed | For | Status |
|---|---|---|
| Multiline text (textarea or `text-field` multiline prop) | `longText` answers | flagged in 011 |
| Checkbox group | `multiChoice` answers | flagged in 011 |
| Pagination | admin tables (library, responses) | flagged here - compose from `button`s until upstream lands |
| Toast/notification | save/publish/action feedback | flagged here - use inline `alert` until upstream lands |
| Progress/loading indicator | streaming agent proposals, exports | flagged here - use `text` + `aria-busy` until upstream lands |
