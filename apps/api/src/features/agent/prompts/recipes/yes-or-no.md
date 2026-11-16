# Yes or no

**Use for:** a plain two way question: have you been here before, do you smoke, is this a work injury, do you have other cover.

**Settings**

- `boolean`, `required: true` unless the form marks the question voluntary.
- `yesLabel` and `noLabel` where Yes and No are not the words the question asks for: "I have", "I have not"; "Still a smoker", "Never smoked".
- `messages.required` in the form's own words.
- Where the question has a third real answer, such as not sure or not applicable, use a `singleChoice` with three options instead. A yes or no cannot hold a third.

**Cannot be expressed**

- An answer forced to be Yes. See the consent and acknowledgement recipe.
- A third value. Yes or no holds two.
- Leaving it genuinely blank once answered, where the form is filled in with scripting on. Say so if the person wants a "no answer" state, and use a single choice with its own option for that.

**Say this when the person wants a third answer**

> Yes or no holds exactly two answers, so I made this a list with your three: yes, no and not sure. It reads the same on screen.

**Corpus sources:** NHS new-patient questionnaire (carer question, smoker and drinker questions), NSW driver licence application (disqualification and health declarations), Australian national private patient hospital claim (compensation, workplace injury, motor accident), US tax withholding W-4 (multiple jobs).
