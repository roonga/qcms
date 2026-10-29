---
"create-qcms-app": minor
---

Register the admin shell's modes, the capability-driven navigation and the landing rules.

- A route-to-mode table in `apps/admin/lib/shell/modes.ts` resolves the shell's mode, so
  no menu decides one by matching strings.
- The application navigation offers only the areas `GET /admin/me/access` projects, and
  Settings and My access move under the avatar.
- Operations and Workspaces are focused modes with their own header, an Exit offered only
  when the caller holds another area, and the normal menus absent rather than disabled.
- `/` resolves the landing area per caller: authoring, then Operations, then Workspaces,
  and My access for a caller holding no feature grant.
- A bookmark into an area the caller does not hold renders a recovery that names nothing
  it refused.
