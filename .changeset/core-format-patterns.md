---
"@roonga/qcms-core": minor
"create-qcms-app": minor
---

Publish `FORMAT_PATTERNS`, a vetted set of `shortText` pattern constraints for email, phone and
five countries' postcodes (issue #1295).

A `pattern` is still a plain expression on the question: there is no `format` field and no kernel
resolution step. What changes is that the expressions no longer have to be written by hand per
question. Each entry carries the expression, its companion `maxLength`, an example and the
plain-words message to put on `messages.pattern`, and every one is proved to sit inside the safe
subset, compile under a browser's `v` flag, and accept and reject a named corpus.

The shapes are checked against their own standards, and each is deliberately looser than the
standard where a respondent would otherwise be refused: ITU-T E.164 for the 15-digit phone ceiling,
USPS DMM 602.1.8 for ZIP+4, Australia Post's data guide, NZ Post for the four-digit New Zealand
postcode, Canada Post plus the PCCF reference guide for the excluded letters, and Royal Mail's
Programmers' Guide table of outward-code shapes.
`docs/DOMAIN_SCHEMA.md` §2.2 carries the sources and the looseness, entry by entry.
