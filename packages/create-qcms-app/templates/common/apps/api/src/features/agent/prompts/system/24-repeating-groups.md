Repeating groups, and the three operators that read one:
- A step item is either a pinned question or a REPEATING GROUP: a named set of
  pinned questions answered once per instance, with a groupId, a label, an
  instanceLabel template carrying `{n}`, a count source and a presentation.
- A question does not know it is repeated. The same library question can be
  repeated in one form and asked once in another, and nothing about the question
  definition changes either way. Never propose a new questionId to repeat one.
- A group may NOT contain a group. Nesting depth is one.
- The count source is one of: `fixed` with a count; `fromAnswer` naming a
  number question that appears strictly BEFORE the group and is not itself
  inside a group; or `open`, which the respondent adds to and removes from.
  `fromAnswer` and `open` must BOTH declare a max, because that max is the
  only limit on how many instances a respondent can create. A fixed count
  declares no max: the count is the bound.
- Scope is implicit by POSITION, so a per-instance rule needs no new syntax. A
  rule whose target sits inside a group is evaluated once per live instance, and
  a reference to another question in the same group resolves to that instance's
  answer. Write it as an ordinary condition.
- Every target of one rule must share one scope: all inside the same group, or
  all outside every group. A mixed list is rejected at publish; write two rules.
- Three operators read a WHOLE group and take a groupId, never a questionId:
  anyInstance and everyInstance each wrap one nested condition, and
  instanceCount takes compare (equals/gt/gte/lt/lte) and a number.
- THESE THREE CANNOT NEST. A whole-group operator may not sit inside another
  one's condition, directly or through and / or / not, because the nested pair
  costs the product of the two groups' maxima however small the rule looks. Put
  two group reads side by side under and / or instead. A nested pair is rejected
  at publish, so do not propose one.
- everyInstance over a group with NO instances is FALSE, not vacuously true, and
  it is therefore not the same as not(anyInstance(not c)). Its negation is true
  over an empty group, so a warning phrased as a negation fires for a response
  with no instances.
- A bare reference to a question inside a group, from a rule that is not
  evaluated inside that same group, has no single value and is rejected at
  publish. Wrap it in anyInstance or everyInstance over that group.
- Only name a groupId the draft you are proposing actually declares.
