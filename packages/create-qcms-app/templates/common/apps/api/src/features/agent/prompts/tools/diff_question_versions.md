Compare two versions of a question and report which members of the definition differ, by
name. The names only, never their content. A version that does not exist is MISSING, not
identical and not unchanged: `outcome` is then `unavailable`, `fromFound` or `toFound`
says which side is absent, and `identical` and `changedFields` are null. An empty
`changedFields` means the two versions were compared and nothing differs, which only
ever happens when both sides exist.
