# A supporting document or piece of evidence

**Use for:** proof of identity, a receipt, a medical certificate, a birth certificate, a photograph, a police report.

**Settings**

- There is no file question and no upload. Do not propose one and do not imply the form can take an attachment.
- List what has to be supplied in the step title or in `help`, in the source form's own words, as a list the respondent reads.
- Where the form must record what they are sending, add a `multiChoice` over the documents the source form names, with `constraints.minSelected: 1` where at least one is needed.
- Where the form must record a document's details, add the ordinary questions for them: a `shortText` for the reference number, a `date` for the date issued.
- Say in the step title how the documents themselves are to be sent, which is a decision for the person, not for you.

**Cannot be expressed**

- Attaching a file of any kind. No question type takes one.
- A photograph, a scan or a signature image.
- A check that a document named as supplied really was.

**Say this**

> This product has no way to attach a file, so the certificates cannot come through the form. What I have done is list what is needed and ask them to tick what they are sending, with the reference numbers typed in. How the documents reach you is up to you, and I have left a line in the heading for you to fill in.

**Corpus sources:** Australian passport application (supporting document instructions), NSW driver licence application (proof of identity instructions), ahm travel insurance claim (receipts, medical documentation), Canadian adult passport (citizenship evidence), US naturalization N-400 (eligibility evidence).
