# Email address

**Use for:** an address the form writes back to.

**Settings**

- `shortText` with `constraints.pattern: ^[^@\s]+@[^@\s]+\.[^@\s]{2,}$`.
- `constraints.maxLength: 254`.
- `required` as the form needs it. Where a respondent may give either an address or a phone number, make both optional and say so in `help`, because nothing can require one of two.
- `messages.pattern` in plain words: "Enter an email address, like name@example.com."

**Cannot be expressed**

- There is no email type and no built-in email check. The rule above is the whole of it.
- Whether the address exists or receives mail.
- A confirm-your-email second box agreeing with the first. No rule compares two answers.
- A rule that one of two contact questions must be answered.

**Say this**

> It checks the address has one at sign and a dot after it, which catches a typed mistake but not a wrong address. There is no way to make the form send a test message, and a second confirm box cannot be checked against the first.

**Corpus sources:** Council customer satisfaction survey (required versus optional contact inputs), NHS new-patient questionnaire, ahm travel insurance claim.
