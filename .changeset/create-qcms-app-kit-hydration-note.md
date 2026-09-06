---
"create-qcms-app": patch
---

The scaffolded admin's `components/kit.tsx` no longer tells an adopter that the auth loop
"works before hydration" without qualification (issues #210, #804). It did, and for typed
input it was false: react-aria rendered a controlled input whatever it was handed, so the
hydrating commit wrote its own empty state over anything typed into the server-rendered
field first, and on the `required` six-digit code field the browser's own constraint
validation then refused the submit in silence. The vendored `TextField` fixes that at its
cause in this release, and the comment now says which half was true when and why, because
the scaffolded source is the adopter's to maintain and a comment that quietly used to be
wrong is worse than no comment.

Templates are generated from `apps/`, so this is the same edit the repository's own admin
carries, regenerated with `pnpm qcms:sync-templates`.
