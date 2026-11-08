# US American Community Survey (ACS)

- Domain: survey
- Jurisdiction: United States
- Language: English
- Publisher: US Census Bureau
- Collection status: **downloaded**
- Collected/checked: 1 November 2026 (Australia/Sydney)
- Official source: [US Census Bureau](https://www.census.gov/programs-surveys/acs/about/forms-and-instructions/2025.html)

## Collected material and limitations

Twenty-page 2025 informational questionnaire, explicitly marked informational copy. Suitable for household and person-level routing; not a live Census response. Retain the printed skip instructions and limits on paper person slots.

| Asset                     | Pages | Format / fields                     | Original download                                                                                          |
| ------------------------- | ----: | ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `source.pdf` (not stored) |    20 | AcroForm; 54 AcroForm field entries | [Publisher file](https://www2.census.gov/programs-surveys/acs/methodology/questionnaires/2025/quest25.pdf) |

Page counts and PDF form types were checked locally with Poppler. AcroForm field counts are library observations, not question counts; null or missing counts do not mean there are no questions. Checksums and exact retrieval URLs are in [the corpus manifest](../manifest.json).

## Suggested test scenarios

- Separate housing questions from repeated person questionnaires and relationship information.
- Exercise age-dependent questions and employment, commuting, disability and income skip paths.
- Keep select-all responses, write-in alternatives, money fields and not-applicable routes distinct.

These are manual evaluation targets, not implemented tests or validated QCMS definitions. Compare any future extraction with the original wording, answer choices and explicit routing. Use synthetic answers only.

## Rights and provenance

Original publisher material is retained unchanged where downloaded. Third-party forms are not covered by the repository MIT licence. No broader redistribution or adaptation permission is asserted; consult the publisher notices before reuse beyond this test corpus. No completed respondent forms were collected.
