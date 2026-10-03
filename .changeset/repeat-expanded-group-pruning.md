---
"@roonga/qcms-ui": patch
---

Prune an already-expanded repeating group against the visible set (issue #1041)

A group member hidden in one instance by a per-instance rule was still rendered on the hydrated path. `expandRepeatGroups` returned an already-expanded group untouched, `documentForVisible` skips a `RepeatGroup` subtree by design because it cannot tell a template's bare member names from an instance's qualified ones, and the hydrated portal expands before it prunes - so the visible set reached neither. The no-JS path composes the two the other way round and was correct.

An expanded group is now pruned against `visible` when one is given, comparing each control's name as it stands rather than re-qualifying it. Idempotence is unchanged: no instance is cloned twice, and a group with nothing to prune is returned referentially unchanged, so `useMemo` downstream still sees the tree it saw before. A call with no visible set, which is what the admin preview makes, prunes nothing.
