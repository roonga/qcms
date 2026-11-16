Compare two published versions of a form, or one of them against its working draft
(null), and report which steps, pinned questions and rules differ. A side that does not
exist is MISSING, not empty: `outcome` is then `unavailable`, `fromFound` or `toFound`
says which side is absent, and every comparison field is null. A form with no working
draft comes back that way, so never read it as a draft that has been emptied. Structure
only: no authored text and no response data.
