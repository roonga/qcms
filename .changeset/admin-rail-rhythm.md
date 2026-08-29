---
"qcms-admin": patch
---

The rail is one column again, on all eight form screens (Code Owner, 2026-08-30).

The rail is rendered twice - a server-rendered version for the six routes and a client-rendered
one for the builder's two screens - and the two had drifted apart in ways that were invisible
from inside either screen and showed only as movement when a reader walked between them.

- A row with a `⋮` trigger gave 30px up to it, so the form row and every step row was a 193px
  box on the builder and a 223px box everywhere else. The trigger is painted over the gutter
  the row already reserves now, so both are 223px with their text in one place.
- The 8px under Rules came from a wrapper only the builder rendered, so the six route rows sat
  8px lower there. The gap belongs to the Rules row, and is written there.
- The 30px reserve for the trigger never reached the server-rendered step rows at all, so a long
  step title wrapped at a different point on each side of a navigation - the exact defect that
  reserve exists to prevent.

Both branches now render the same wrapper, which is what makes one rule reach both.

The column also has one rhythm. It carried 0px, 2px, 8px and 10px gaps at once, and a 52px add
control among 40px rows. Every gap is now the 2px between rows of a group or the 8px between
groups, every row is 40px, and `--admin-rail-row-gap` is where the 2px is written.
