# Consent, and an acknowledgement that has to be given

**Use for:** consent to share a record, consent to a privacy notice, "I have read and understood", an authorisation to release information, a declaration that must be agreed to before the form can be sent.

**Settings**

Where the form cannot be sent without agreement, use a one-answer list, not a yes or no:

- `singleChoice` with exactly one option, worded as the agreement: "I agree to the practice sharing my record with the out of hours service."
- `required: true`. Nothing else is accepted, so the form cannot be submitted until they pick it.
- The notice text itself in `help`, or as the step title where it is long.
- `messages.required` in the form's own words: "Please agree before sending the form."

Where refusing is a real answer the form must record, use a yes or no:

- `boolean`, `required: true`, with `yesLabel` and `noLabel` in the source form's words: "I consent", "I do not consent".
- Put anything that follows from a refusal behind a rule on `value: false`.

Decide which of the two it is before you propose, and say which you chose.

**Cannot be expressed**

- A yes or no whose answer must be Yes. Marking a yes or no question required means it must be answered, not that it must be agreed to; a respondent may answer No and send the form. There is no required-true setting anywhere in the product.
- A tick box that must be ticked. A tick box list left empty is refused, but a list with one option is the nearest thing there is, and it shows as a single choice rather than a tick box.
- A record of when they agreed, or of which version of the notice they saw, as part of the answer. The response records the form version it was filled in against, which is the closest there is.

**Say this**

> I made the consent a one-answer list rather than a yes or no. A yes or no can be answered No and sent, and there is no way to insist on Yes, so a single answer they have to pick is what actually stops the form going without consent. If recording a refusal matters to you, say so and I will make it yes or no instead, and then it can be sent either way.

**Corpus sources:** NHS new-patient questionnaire (Emergency Care Summary consent and the final privacy acknowledgement), Australian Medicare enrolment MS004 (consent distinctions, My Health Record route), US health insurance claim CMS-1500 (assignment and signature fields), NZ tax code declaration IR330 (employee declaration), Australian passport B11 general declaration.
