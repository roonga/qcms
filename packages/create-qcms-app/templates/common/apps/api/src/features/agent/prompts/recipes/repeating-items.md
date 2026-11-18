# Repeating items: people, service lines, previous names

**Use for:** up to five people on one enrolment, each person in a household, six service lines on a claim, previous names, previous addresses, each dependant, each treatment.

**Settings**

- One repeating group in the step's item list, holding the questions asked once per thing.
- The questions inside it are ordinary library questions. A question does not know it is repeated, so never make a second copy of a question to repeat it.
- `label` for the set, as in "People to enrol", and `instanceLabel` carrying `{n}` for each one, as in "Person {n}".
- A count source, one of three:
  - `fixed` with a count, where the source form has exactly that many slots. The count is the limit, and no maximum is declared.
  - `fromAnswer`, naming a number question that comes strictly before the group and is not itself inside a group. A maximum must be declared.
  - `open`, which the respondent adds to and removes from. A maximum must be declared.
- A `presentation`: `stacked` for a card per thing, `perInstanceStep` for a page per thing, `table` for a row per thing. The table layout takes only short text, number, date, yes or no and pick-one columns, so a longer typed answer or a select all that apply cannot be a column.
- A rule whose target sits inside the group is applied once per thing, and a reference to another question in the same group means that thing's answer. Write it as an ordinary rule.

**Cannot be expressed**

- A group inside a group. The nesting depth is one, so a household of people each with several jobs cannot be built as written. Flatten it, or ask the jobs of one person only.
- A longer typed answer or a select all that apply as a table column. Use the stacked layout where the source form needs one.
- A rule comparing one thing with another within a set, or asking whether two of them are the same.
- An unbounded set. A maximum is needed for both the counted and the open sources, and it is the only limit on how many a respondent can create.

**Say this**

> Each person gets the same set of questions, and the number of people comes from the count they give earlier. One thing had to be flattened: the source form asks about each job of each person, and a repeating set cannot sit inside another repeating set, so the plan asks for the main job only. Tell me if the others matter and we will find another shape.

**Corpus sources:** Australian Medicare enrolment MS004 (up to five people, shared contact details, repeated people and relationships), US American Community Survey (repeated person questionnaires, limits on paper person slots), US health insurance claim CMS-1500 (six service lines with dates, codes, units and amounts), US naturalization N-400 (repeated name, residence, employment, travel and family information), Australian national private patient hospital claim (repeated diagnoses and procedures), NSW driver licence application (previous names and previous licences).
