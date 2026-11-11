# Design brief: showing per-environment state on authoring screens

## Problem

Authoring screens (Questions, Forms, Workspaces) are environment-independent, and the environment selector now lives only in Operations. Some facts about an item still differ per environment, and people need them while authoring.

- Today the Forms list and form headers show one "Status: Open or Closed" that silently follows the selected environment, with no label. That is a leak, and it cannot be corrected from the screen.
- Other per-environment facts exist or will: which version is released where, whether intake accepts new sessions, secure-link and webhook configuration, response counts.
- The versions screen already names each environment in its rows. Nothing else does.

## Vocabulary (Code Owner, 2026-11-08)

"Intake" is renamed **Availability**. States: **Open**, **Closed**, **Not Released** (nothing released in that environment; Title Case because it is a chip label). Failure states: **Unknown** (the state could not be loaded; accessible name "prod: state unknown, couldn't load. Retry"; dashed, not a link) and **No access** (the caller cannot read that environment's state; dashed with a lock, not a link). Not the environment chip's own "unknown" kind (environment list unreadable), which says "Environment unknown". Actions: Close, Reopen. Per environment it reads "prod: Open", "prod: Closed", "prod: Not Released". The Versions column "Available in" becomes "Released to" so "available" has one meaning.

## Ask

Design one generic pattern for showing per-environment state of an item anywhere outside Operations. Intake status is the first use, not the only one: the pattern must carry any per-environment fact (status, released version, counts, health) for any number of environments.

## Decisions needed

1. **Where it shows:** list rows (a column or inline), item headers, the rail, and a summary strip. Say which surfaces show it by default and which on demand.
2. **Form of the display:** one compact indicator per environment (for example a chip row, a dot matrix, or a small table) and how it scales from two environments to six.
3. **Naming and colour:** environments are the only colour-coded concept. Say whether the indicator uses the environment slot colours or neutral marks with the name, and how state (open, closed, released, none) is shown without relying on colour.
4. **Filtering and sorting:** how a list is filtered by a per-environment fact ("closed in prod") without a global environment selector.
5. **Linking:** how an indicator leads to the Operations screen for that environment and item (the deep link, and what the Operations screen opens on), including the Operations environment staying separate from this display.
6. **Empty and unknown:** an environment the caller cannot see, one that has no release, one that errors.
7. **Single environment:** nothing extra is drawn when there is only one environment.
8. **Density:** a form list with many rows, and a phone layout.

## Constraints

- Admin only. Authoring never changes with the selected environment; this display is read-only and never edits state (changes happen in Operations).
- Accessible: the state and the environment name are text, readable by screen reader as "prod: closed", with a visible label, never colour alone, in all four themes (light, dark, hc, hc-dark).
- Hits the same selected-row, rail and chip styles already in the design system (environment chip, slots 1 to 6, current-row mark).
- No layout shift, no long help text (a `?` hover if needed, see the help icon brief).
- Workspaces are a real boundary and are never colour-coded.

## Deliver

- The pattern on the Forms list, a form header, the rail, and one Questions screen, with two environments and with four.
- Closed, open, mixed, empty, unknown and no-access states, desktop and phone, all four themes.
- A ruling on each decision above.
- Update the QCMS design system artifact in the same pass (an Environment state card and its README rules).

## Current implementation (for reference)

- List status column and filter: `apps/admin/app/(shell)/forms/forms-table.tsx`, `apps/admin/lib/forms/list-filters.ts`.
- Header and rail status: `apps/admin/components/forms/form-page-header.tsx`, `apps/admin/lib/server/form-rail.ts`.
- Per-environment rows already shown: `apps/admin/app/(shell)/forms/[formId]/versions/page.tsx` (`EnvironmentSummary`).
- Data: `docs/environment-capabilities.md` ("Shared content and environment state").
