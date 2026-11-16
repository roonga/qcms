# A rating scale

**Use for:** a five point agreement scale, a six point frequency scale, a nought to ten overall rating, a satisfaction rating.

**Settings**

- `singleChoice`, with one option per point of the scale, in the source form's order and its exact words. Keep "Strongly agree" and "Strongly disagree" at the ends the source puts them.
- A stable option id per point, readable rather than numbered, so the meaning survives a reworded label.
- `required: false` where the source form lets a row go unanswered, and `required: true` where it does not. This is the only thing that keeps a missing rating apart from the middle answer, so decide it deliberately.
- `messages.required` in the form's own words.
- A nought to ten rating is also a `singleChoice`, with eleven options labelled as the source labels them, including the words at each end. Do not use a number question: a number accepts 7.5 and anything outside the scale.

**Cannot be expressed**

- A score per point, and any total or average over a set of ratings.
- A slider, a star row, or a scale drawn as one line of buttons. The product shows a short list as buttons and a long one as a drop-down, and the choice is the product's.
- Labels on only the two ends, with the middle points unlabelled.
- A reversed scale handled automatically in reporting.

**Say this**

> Each rating is its own question with your five answers in your order. The form records which answer they picked; it does not score them or work out an average, so that happens wherever you read the results.

**Corpus sources:** Course evaluation survey (five ordered agreement labels on every rating row, missing rating kept apart from the neutral response), WHO-5 wellbeing survey (five statements, six ordered response choices, score direction), CAHPS health plan experience survey (frequency scales versus nought to ten overall ratings), Council customer satisfaction survey (advisor and service rating controls).
