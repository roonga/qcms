---
"create-qcms-app": patch
---

The scaffolded admin reads a question once per request on the question detail screen (issue #808).

The question detail screen renders as three server trees from one request: the shell layout,
`app/(shell)/questions/[questionId]/page.tsx`, and the `@rail` slot beside it. The page and the
rail both need the same question, they are separate React trees, and neither can hand the other
a value, so the same `GET /admin/questions/{id}` went out twice per render. `getQuestion` now
memoizes per request at its own definition in `lib/server/questions.ts`, the way `getForm` has
since issue #626, and one render makes one session read and one question read instead of three
and two.

`lib/server/question-rail.ts` carried the pointer naming this answer and the file it belonged in;
it now states the cost the rail actually has, which is none beyond the read the page was already
making. The scaffolded templates carry both changes.
