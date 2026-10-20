---
"create-qcms-app": patch
---

Name the response row's anchor with the id the cell paints (WCAG 2.5.3).

The responses table paints an abbreviated session id, `ses_45cf6345`, and the anchor over
it answered to `Open response ses_45cf634512ab9f0e77c1d2e3f4a5b6c7`. The visible string is
a prefix of that name but not a word of it, so an operator saying what the cell shows
matched nothing - the same label-in-name failure as issues #879 and #1010, reached by a
third route. The name is now `ses_45cf6345, open response ses_45cf634512ab...`: the
painted text first, then the whole id, which stays in the name so a row is still announced
by a value that identifies it (issue #582). `EntityId`'s `linkLabel` is now a function of
the painted head rather than a plain string, so the front of the name and the front of the
cell are one string by construction and cannot drift apart again.
