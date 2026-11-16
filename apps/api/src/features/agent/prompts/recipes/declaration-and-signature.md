# A declaration and a signature

**Use for:** a signed statement of truth, an applicant declaration, a guarantor or witness signature, an employee declaration, an authorisation to release information.

**Settings**

- The statement itself as the step title, or in the `help` of the question that follows it. Keep the source form's wording, which is usually legal text.
- A one-answer `singleChoice` agreeing to it, `required: true`, as in the consent recipe.
- A `shortText` for the name of the person declaring, `required: true`, `constraints.maxLength: 200`. Where the person declaring may differ from the applicant, ask for both and say in `help` when the second is needed.
- A `date` for the date of the declaration, with fixed bounds as in the past date recipe.
- Where the source form has several signatory roles, make each role its own set of these questions, in its own step, titled by the role.

**Cannot be expressed**

- A signature. There is no drawing field, no image field and no file field, so a handwritten signature cannot be captured at all.
- A witnessed or counter-signed declaration as one act.
- Any legal weight. A typed name and an agreement are what the form holds.

**Say this**

> I can hold the declaration, the agreement to it and the name and date typed in. What I cannot do is take a signature: there is nowhere in this product to draw or attach one. If the declaration has to be signed by hand, that part stays on paper, and this form collects everything around it.

**Corpus sources:** Australian passport B11 general declaration (physical signature requirement, applicant distinct from the person declaring), NSW driver licence application (signatures and proof of identity), US naturalization N-400 (distinct applicant, interpreter and preparer roles), US health insurance claim CMS-1500 (assignment and signature fields), NZ tax code declaration IR330, US tax withholding W-4 (employee signature, employer section).
