# US BRFSS health survey questionnaire

- Domain: survey
- Jurisdiction: United States
- Language: English
- Publisher: US Centers for Disease Control and Prevention
- Collection status: **downloaded**
- Collected/checked: 1 November 2026 (Australia/Sydney)
- Official source: [US Centers for Disease Control and Prevention](https://www.cdc.gov/brfss/questionnaires/)

## Collected material and limitations

109-page questionnaire labelled 2024; the retrieved publisher file has a September 2026 date on its cover. Treat it as this exact revision, not an immutable original 2024 release. Interviewer/CATI instructions and response codes are part of this instrument.

| Asset                     | Pages | Format / fields | Original download                                                                                               |
| ------------------------- | ----: | --------------- | --------------------------------------------------------------------------------------------------------------- |
| `source.pdf` (not stored) |   109 | AcroForm        | [Publisher file](https://www.cdc.gov/brfss/questionnaires/pdf-ques/2024-BRFSS-Questionnaire-508.pdf?download=1) |

Page counts and PDF form types were checked locally with Poppler. AcroForm field counts are library observations, not question counts; null or missing counts do not mean there are no questions. Checksums and exact retrieval URLs are in [the corpus manifest](../manifest.json).

## Suggested test scenarios

- Distinguish spoken question text from interviewer-only routing and coding instructions.
- Preserve refusal, do-not-know and not-asked codes separately from ordinary choices.
- Exercise health, demographic and optional-module skip logic across a long questionnaire.

These are manual evaluation targets, not implemented tests or validated QCMS definitions. Compare any future extraction with the original wording, answer choices and explicit routing. Use synthetic answers only.

## Rights and provenance

Original publisher material is retained unchanged where downloaded. Third-party forms are not covered by the repository MIT licence. No broader redistribution or adaptation permission is asserted; consult the publisher notices before reuse beyond this test corpus. No completed respondent forms were collected.
