# Question type recipes for the authoring assistant

**Status:** authoritative inventory (issue #1270) · **Applies to:** the admin authoring assistant

The assistant builds questions without the constraints a form author would add unprompted. This file is the inventory behind the fix: the common question types, what the question definition and the engine can express for each one today, and what they cannot.

The recipes themselves are prompt text, one file per type in `apps/api/src/features/agent/prompts/recipes/`. Each file stem is a type the `question_recipes` lookup tool takes, and the stems are that tool's whole enum. A system section tells the assistant to look one up before proposing a question of that type, apply it, and say plainly what could not be applied. Editing a recipe is editing the prompt: follow `apps/api/src/features/agent/prompts/README.md` and bump the prompt version.

Every "can" below cites the code rather than a document. Every "cannot" is stated outright, because the whole point of a recipe is that the assistant says plainly what it could not apply.

## 1. The types

29 types in seven groups. The verdict column is about the rule a form author would expect, not about whether a question of that shape can be created at all:

- **full**: every rule the recipe states can be set in the definition.
- **partial**: the main rule can be set, and something a form author would ask for cannot.
- **none**: the rule that defines the type cannot be set at all.

16 full, 8 partial, 5 none.

### Identity and person

| Type                                                                                     | Verdict | Corpus sources                                                     |
| ---------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| [Person name](../apps/api/src/features/agent/prompts/recipes/person-name.md)                                     | full    | NSW licence, N-400, Canadian passport, B11 declaration, NHS intake |
| [Date of birth](../apps/api/src/features/agent/prompts/recipes/date-of-birth.md)                                 | partial | NHS intake, Medicare MS004, ACS, Canadian passport, N-400          |
| [Age in years](../apps/api/src/features/agent/prompts/recipes/age-in-years.md)                                   | full    | ACS, BRFSS, NHS intake                                             |
| [Reference number with a set format](../apps/api/src/features/agent/prompts/recipes/identifier-with-a-format.md) | full    | IR330, CMS-1500, Medicare MS004, NSW licence, Canadian passport    |

### Contact

| Type                                                     | Verdict | Corpus sources                                    |
| -------------------------------------------------------- | ------- | ------------------------------------------------- |
| [Email address](../apps/api/src/features/agent/prompts/recipes/email-address.md) | full    | Council satisfaction, NHS intake, ahm claim       |
| [Phone number](../apps/api/src/features/agent/prompts/recipes/phone-number.md)   | full    | B11 declaration, NHS intake, Council satisfaction |
| [Postcode](../apps/api/src/features/agent/prompts/recipes/postcode.md)           | full    | Council satisfaction, Canadian passport, ACS      |
| [Address](../apps/api/src/features/agent/prompts/recipes/address.md)             | full    | Canadian passport, B11 declaration, CMS-1500      |

### Dates and times

| Type                                                                    | Verdict | Corpus sources                                           |
| ----------------------------------------------------------------------- | ------- | -------------------------------------------------------- |
| [A date that has already happened](../apps/api/src/features/agent/prompts/recipes/past-date.md) | partial | Hospital claim, ahm claim, NHS intake, Canadian passport |
| [A date in the future](../apps/api/src/features/agent/prompts/recipes/future-date.md)           | partial | ahm claim, NSW licence, Medicare MS004                   |
| [A date range, from and to](../apps/api/src/features/agent/prompts/recipes/date-range.md)       | none    | Hospital claim, CMS-1500, Canadian passport, N-400       |
| [A time of day](../apps/api/src/features/agent/prompts/recipes/time-of-day.md)                  | none    | Hospital claim, ahm claim, BRFSS                         |

### Choice

| Type                                                                                   | Verdict | Corpus sources                                     |
| -------------------------------------------------------------------------------------- | ------- | -------------------------------------------------- |
| [Yes or no](../apps/api/src/features/agent/prompts/recipes/yes-or-no.md)                                       | full    | NHS intake, NSW licence, Hospital claim, W-4       |
| [Yes or no, with a follow-up](../apps/api/src/features/agent/prompts/recipes/yes-or-no-with-detail.md)         | full    | NHS intake, NSW licence, Medicare MS004, ahm claim |
| [Pick one from a list](../apps/api/src/features/agent/prompts/recipes/single-choice.md)                        | full    | IR330, W-4, NSW licence, Council satisfaction, ACS |
| [Select all that apply](../apps/api/src/features/agent/prompts/recipes/select-all-that-apply.md)               | full    | ACS, ahm claim, NHS intake, BRFSS                  |
| [None of the above](../apps/api/src/features/agent/prompts/recipes/none-of-the-above.md)                       | none    | ACS, BRFSS, Council satisfaction, Medicare MS004   |
| [Other, please specify](../apps/api/src/features/agent/prompts/recipes/other-please-specify.md)                | partial | ACS, BRFSS, NHS intake, ahm claim                  |
| [Voluntary and non-answer choices](../apps/api/src/features/agent/prompts/recipes/voluntary-and-non-answer.md) | full    | BRFSS, Medicare MS004, NSW licence, ACS            |

### Measurement

| Type                                                                        | Verdict | Corpus sources                                        |
| --------------------------------------------------------------------------- | ------- | ----------------------------------------------------- |
| [A quantity, a count, or a measurement](../apps/api/src/features/agent/prompts/recipes/quantity.md) | full    | CMS-1500, Canadian passport, W-4, Medicare MS004, ACS |
| [A money amount](../apps/api/src/features/agent/prompts/recipes/money-amount.md)                    | partial | CMS-1500, W-4, ACS, Hospital claim, ahm claim         |

### Rating

| Type                                                                            | Verdict | Corpus sources                           |
| ------------------------------------------------------------------------------- | ------- | ---------------------------------------- |
| [A rating scale](../apps/api/src/features/agent/prompts/recipes/rating-scale.md)                        | full    | Course evaluation, WHO-5, CAHPS, Council |
| [A battery of statements on one scale](../apps/api/src/features/agent/prompts/recipes/scale-battery.md) | partial | WHO-5, Course evaluation, CAHPS          |

### Consent, text, evidence, repetition

| Type                                                                                        | Verdict | Corpus sources                                                        |
| ------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------- |
| [Consent and acknowledgement](../apps/api/src/features/agent/prompts/recipes/consent-and-acknowledgement.md)        | partial | NHS intake, Medicare MS004, CMS-1500, IR330, B11                      |
| [A declaration and a signature](../apps/api/src/features/agent/prompts/recipes/declaration-and-signature.md)        | none    | B11, NSW licence, N-400, CMS-1500, IR330, W-4                         |
| [A short typed answer, with a length limit](../apps/api/src/features/agent/prompts/recipes/short-free-text.md)      | full    | Council satisfaction, Canadian passport, N-400, ACS                   |
| [A longer typed answer](../apps/api/src/features/agent/prompts/recipes/long-free-text.md)                           | partial | Course evaluation, NHS intake, B11, Council satisfaction              |
| [A supporting document or piece of evidence](../apps/api/src/features/agent/prompts/recipes/supporting-document.md) | none    | Australian passport, NSW licence, ahm claim, Canadian passport, N-400 |
| [Repeating items](../apps/api/src/features/agent/prompts/recipes/repeating-items.md)                                | full    | Medicare MS004, ACS, CMS-1500, N-400, Hospital claim, NSW licence     |

### How the corpus was read

`docs/use-cases/` holds 19 cases, 16 with local material at collection time. The publisher originals are not committed, so every type above was drawn from each case's own README and from `docs/use-cases/manifest.json`, which record the collected material, its coverage gaps and the suggested test scenarios. No PDF was opened.

The types the issue's own list did not name, and which the corpus made visible, are: a reference number with a set format (IR330's eight or nine digit tax number, kept as text so a leading zero survives), an address, a date range, a time of day, a money amount, a battery of statements, a declaration and signature, a supporting document, repeating items, and the non-answer codes BRFSS keeps apart from ordinary choices. The issue's own hypothesis list is otherwise confirmed in full: every type it named appears in the corpus.

## 2. What the definition and the engine express today

### The closed set of types

Seven, and adding one is a versioned core change: `packages/core/src/question-definition.ts:237-245` (the union) and `:250-262` (`QUESTION_TYPES`). `shortText`, `longText`, `number`, `date`, `boolean`, `singleChoice`, `multiChoice`. `docs/DOMAIN_SCHEMA.md:90-151` restates them.

### Every constraint there is

| Type           | Constraints                                         | Code                                               |
| -------------- | --------------------------------------------------- | -------------------------------------------------- |
| `shortText`    | `minLength`, `maxLength`, `pattern`                 | `packages/core/src/question-definition.ts:112-130` |
| `longText`     | `maxLength` only                                    | `packages/core/src/question-definition.ts:132-135` |
| `number`       | `min`, `max`, `integer`                             | `packages/core/src/question-definition.ts:137-155` |
| `date`         | `min`, `max`, each a literal `YYYY-MM-DD`           | `packages/core/src/question-definition.ts:157-174` |
| `boolean`      | none; `yesLabel` and `noLabel` are presentation     | `packages/core/src/question-definition.ts:176-184` |
| `singleChoice` | none; one or more options                           | `packages/core/src/question-definition.ts:186-191` |
| `multiChoice`  | `minSelected`, `maxSelected`                        | `packages/core/src/question-definition.ts:193-231` |
| every type     | `required`, defaulting to false                     | `packages/core/src/question-definition.ts:66`      |
| every type     | `messages`, one authored message per constraint set | `packages/core/src/question-definition.ts:71`      |

Cross-field refinements report every violation at parse: `minLength` not above `maxLength`, `min` not above `max` for both number and date, `minSelected` not above `maxSelected` and neither above the option count, unique option ids, non-empty option labels (`:96-110`, `:121-130`, `:146-155`, `:165-174`, `:202-231`).

### Validation messages

The nine keys an author may decorate are `required`, `minLength`, `maxLength`, `pattern`, `min`, `max`, `integer`, `minSelected`, `maxSelected`: `packages/core/src/validation-message.ts:10-20`, ordered canonically at `:28-29`. `authoredMessageKeys` (`packages/core/src/question-definition.ts:327-338`) narrows that to the constraints the question actually carries, and publish reports a key for a constraint that is absent (`ORPHAN_MESSAGE_KEY`, `packages/core/src/publish-error.ts:29`). A `boolean` and a `singleChoice` carry no decorable constraint beyond `required`: `packages/core/src/question-definition.ts:307-311`.

Enforcement is every constraint, never only the first, and `required` is not among them: `packages/core/src/validate-answer.ts:179-183`. The failure codes and the constraint names are at `:20-31` and `:38-55`.

### Conditions

Sixteen operators, a closed set: `equals`, `notEquals`, `in`, `gt`, `gte`, `lt`, `lte`, `answered`, `contains`, `containsAny`, `and`, `or`, `not`, `anyInstance`, `everyInstance`, `instanceCount` (`packages/core/src/visibility-rule.ts:20-41`). Nesting is capped at 8 (`:13`). A rule is a condition plus the steps or questions it shows (`:139-143`), and a targeted item is hidden until a rule matches.

Facts that bear on the recipes:

- `contains` and `containsAny` are for a `multiChoice` answer only, and `equals` over one is set equality: `packages/core/src/visibility-rule.ts:81-88`, `packages/core/src/answer-value.ts:179-200`.
- `gt`, `gte`, `lt`, `lte` take a number or a `YYYY-MM-DD` date and nothing else: `packages/core/src/answer-value.ts:71-72`.
- Every operand is a literal. No condition reads a second answer, so no rule compares one answer with another.
- Evaluation is one forward pass, so a rule may only target something later in document order (`RULE_BACKWARD_TARGET`, `packages/core/src/publish-error.ts:23`).
- A hidden required question is never swept at submission: `prepareSubmission` walks `flowState.visible` alone (`packages/core/src/prepare-submission.ts:169-190`). This is what makes "required when revealed" work for a follow-up.
- A rule reading a `multiChoice` answer whose target sits on the same step is a publish warning, because that answer commits only when focus leaves the group: `packages/core/src/publish-warning.ts:11-31`, ADR-31's commit table at `docs/adr/portal.md:62-83`.

### Dates: min and max

`date` takes `min` and `max`, each a literal canonical date, parsed as a real calendar date and compared lexicographically, which over that encoding is calendar order: `packages/core/src/question-definition.ts:157-174`, `packages/core/src/answer-value.ts:42-46`, `packages/core/src/validate-answer.ts:163-177` and `:212-220`.

**There are no relative dates.** Nothing in the kernel names today, an offset from today, or an age in years; `grep -ri "relative date\|today" packages/core/src` returns nothing. A bound is a fixed date, authored once, and it is stale the following day. This is gap G1 and it is the direct cause of the date of birth defect in the issue.

### Required-true for consent

**There is none.** `required` is a boolean on `QuestionBase` meaning the question must hold a non-blank answer (`packages/core/src/question-definition.ts:66`, swept at `packages/core/src/prepare-submission.ts:169-190`). A `boolean` carries no constraint at all (`:176-184`) and `validateAnswer` checks nothing beyond the encoding for one (`packages/core/src/validate-answer.ts:221-224`). A required consent question answered No submits.

What does work, and is what the recipe proposes: a `singleChoice` with exactly one option and `required: true`. One option is legal (`options: z.array(ChoiceOption).min(1)`, `:188`) and no other value validates (`packages/core/src/validate-answer.ts:225-240`), so the submission sweep blocks until that option is chosen. It renders as a one-member radio group (`packages/a2ui-compiler/src/mapping.ts:160-166`), which a chosen radio cannot be cleared from with scripting on, and whose no-script placeholder option can be returned to (`docs/COMPONENT_GUIDELINES.md:32`). This is gap G3.

### Exclusive options

**There are none.** `ChoiceOption` is an option id and a label and nothing else (`packages/core/src/question-definition.ts:47-60`). `multiChoice` carries `minSelected` and `maxSelected` over the count alone (`:193-231`, enforced at `packages/core/src/validate-answer.ts:261-279`), and no constraint names a pair of options. `maxSelected: 1` forbids every second answer, not the one combination the author means. `grep -ri exclusive packages/core apps/api/src/features/agent` finds nothing of the kind. This is gap G2.

`docs/COMPONENT_GUIDELINES.md:32` records the design position this rests on: "none of these" is sayable only as an authored option, which is exactly why the option exists and the rule about it does not.

### Format checks

A `shortText` `pattern` is the only format check there is: `packages/core/src/question-definition.ts:114-130`, applied under the `u` flag at `packages/core/src/validate-answer.ts:144-160`.

- The accepted subset is deliberately conservative, and every accepted pattern is linear-time-safe: `packages/core/src/safe-pattern.ts`. Backreferences and lookaround are refused (`:114-118`, `:150-155`), a pattern is capped at 256 characters (`:6`), a finite quantifier bound at 1000 (`:8`), and repetition of a group carrying `|` or a quantifier at 32 (`:10`).
- A pattern must also compile under the `v` flag, because a browser compiles the HTML attribute that way: `compilesUnderV` and `toVSafePattern` at `packages/core/src/safe-pattern.ts:235-242` and `:318-322`, refused by the authoring API as `PATTERN_NOT_BROWSER_SAFE` (`docs/DOMAIN_SCHEMA.md:162-167`). Every pattern in the recipes was checked against both.
- `&&` or `--` unescaped inside a character class is a publish warning, not a refusal: `packages/core/src/publish-warning.ts:13`.

**There is no email, phone, postcode or URL check**, named or built in. The compiled control is a plain text field carrying `minLength`, `maxLength` and `pattern`, with no input type and no input mode: `packages/a2ui-compiler/src/mapping.ts:102-111`. Everything an author wants is hand-written as a pattern, once per question, with no shared source. This is gap G8.

### Length limits

`minLength` and `maxLength` on `shortText`, `maxLength` alone on `longText`: `packages/core/src/question-definition.ts:112-135`. They count UTF-16 code units of the canonical string, the unit the typed box itself counts in: `packages/core/src/validate-answer.ts:116-150`. Both reach the control as `minLength` and `maxLength`: `packages/a2ui-compiler/src/mapping.ts:102-116`.

**A `longText` has no minimum length**, so "at least a sentence" cannot be set on the one type whose shape invites it. This is gap G7.

An empty string and an empty selection are refused for every question, required or not, because they are absence rather than answers: `packages/core/src/validate-answer.ts:106-112`, ADR-33.

### Repetition

A step item is a pinned question or a repeating group: `packages/core/src/step.ts`. The count comes from `fixed`, `fromAnswer` or `open` (`:18-33`), a group may not contain a group (`:44-53`), the presentation is `stacked`, `perInstanceStep` or `table` (`:36-37`), and a `table` admits only `shortText`, `number`, `date`, `boolean` and `singleChoice` as columns (`:94-101`). One cross-group rule has a cost budget of 10,000 instance pairs (`:88`).

The `table` presentation is repetition's layout, so a battery of different statements on one scale cannot use it: the statements are different questions, not one question asked per thing. This is gap G12.

### Everything else the engine does not express

Each of these is a rule a corpus case states and the definition cannot hold. No workaround exists beyond prose in `help`:

- a comparison between two answers, in a constraint or in a condition (date range, a stated age against a date of birth, a confirm-your-email box);
- a calculated or derived answer (a worksheet total, an age, a days-between);
- a decimal-place or scale limit on a number, and a currency on a money amount;
- a time of day, or a date and time as one answer;
- a file, an image or a signature;
- a unit chosen by the respondent, with conversion;
- a rule that one of two questions must be answered;
- a per-option follow-up box, inline beside the option;
- grouped options or headings inside one list, and an option set that changes with an earlier answer;
- a score, weight or total over a set of ratings.

## 3. The gaps

One draft issue body per gap, in `$(node scripts/agent-scratch.mjs 1270-gaps)`. Each needs a Code Owner ruling, and the issue is explicit that engine and form-definition changes are out of its own scope.

| Gap | What is missing                                               | Types it blocks                                      | Draft                            |
| --- | ------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------- |
| G1  | Relative date bounds: today, and an offset from today         | date of birth, past date, future date                | `gap-01-relative-date-bounds.md` |
| G2  | An exclusive option on a select all that apply                | none of the above                                    | `gap-02-exclusive-option.md`     |
| G3  | A consent that must be agreed to                              | consent and acknowledgement                          | `gap-03-consent-required.md`     |
| G4  | A constraint or condition comparing two answers               | date range, age against date of birth, email confirm | `gap-04-cross-answer-rule.md`    |
| G5  | A time of day                                                 | time of day                                          | `gap-05-time-of-day.md`          |
| G6  | Decimal places and a currency on a number                     | money amount                                         | `gap-06-money-precision.md`      |
| G7  | A minimum length on a longer typed answer                     | long free text                                       | `gap-07-longtext-min-length.md`  |
| G8  | Named format checks for email, phone and postcode             | email, phone, postcode                               | `gap-08-named-formats.md`        |
| G9  | A file or document question                                   | supporting document                                  | `gap-09-document-question.md`    |
| G10 | A signature                                                   | declaration and signature                            | `gap-10-signature.md`            |
| G11 | A specify box belonging to an option, and the same-step limit | other, please specify                                | `gap-11-option-specify-box.md`   |
| G12 | A matrix layout for a set of questions that is not repetition | scale battery                                        | `gap-12-matrix-layout.md`        |

G1, G2 and G3 are the three defects the issue reports. The rest came out of the corpus.

## 4. Eval scenarios

Three new scenarios in `scripts/agent-review/scenarios/`, drawing their wording from the corpus and inventing every name and every detail:

| Scenario                             | Gap it exercises | Corpus wording                                                   |
| ------------------------------------ | ---------------- | ---------------------------------------------------------------- |
| `08-date-of-birth-limits.json`       | G1               | NHS intake: a questionnaire for patients over five years old     |
| `09-consent-that-must-be-given.json` | G3               | NHS intake: record-sharing consent and a privacy acknowledgement |
| `10-none-of-the-above.json`          | G2               | Council satisfaction: the contact-channel selector               |

Each asserts the form's shape (`formCount`, `questionCount`, `notReleased`) and the settings the recipe calls for, and puts what the assistant has to say in `assistantMust`, which is what a reviewer judges. They are committed and **not run**: a run needs a real model key and costs money (`scripts/agent-review/README.md`).

The settings a scenario may assert are `required`, `optionCount`, `dateMin`, `dateMax` and `pattern`, each naming its question by a substring of the label. A date bound may be compared against `today`, which resolves to the day the end state was read. A setting that was never set reads as absent, which is what makes the original defect, a date of birth open to the year 2100, a failure rather than a judgement call. The three gaps the scenarios exercise are still gaps: what is asserted is the nearest thing the product can express, and what the assistant has to say about the rest stays in `assistantMust`.

## 5. The consent recipe, until G3 is ruled on

Code Owner, 2026-11-16: the consent recipe builds a single-option choice marked required, and the assistant tells the person why it looks that way. A yes or no is offered only where the person says recording a refusal matters more than blocking the submission. That stands until #1290 is ruled on.
