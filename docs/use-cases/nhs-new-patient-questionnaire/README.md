# NHS Logan Practice new-patient questionnaire

- Domain: health
- Jurisdiction: United Kingdom (Scotland)
- Language: English
- Publisher: Logan Practice / NHS Lanarkshire
- Collection status: **downloaded**
- Collected/checked: 1 November 2026 (Australia/Sydney)
- Official source: [Logan Practice / NHS Lanarkshire](https://www.loganpractice.scot.nhs.uk/wp-content/uploads/sites/881/2026/01/New-Patient-Questionnaire-updated.pdf)

## Collected material and limitations

Two-page questionnaire for patients over five years old, not a nationwide NHS registration standard. Contains personal details, next of kin, caring responsibilities, health information, medication and consent.

| Asset                     | Pages | Format / fields                | Original download                                                                                                                  |
| ------------------------- | ----: | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `source.pdf` (not stored) |     2 | none; 0 AcroForm field entries | [Publisher file](https://www.loganpractice.scot.nhs.uk/wp-content/uploads/sites/881/2026/01/New-Patient-Questionnaire-updated.pdf) |

Page counts and PDF form types were checked locally with Poppler. AcroForm field counts are library observations, not question counts; null or missing counts do not mean there are no questions. Checksums and exact retrieval URLs are in [the corpus manifest](../manifest.json).

## Suggested test scenarios

- Show caring-person details only when the carer question is affirmative.
- Exercise smoker/ex-smoker/never-smoked and current/ex/never-drinker choices with conditional stopped dates.
- Separate repeat-medication information, Emergency Care Summary consent and the final privacy acknowledgement.

These are manual evaluation targets, not implemented tests or validated QCMS definitions. Compare any future extraction with the original wording, answer choices and explicit routing. Use synthetic answers only.

## Rights and provenance

Original publisher material is retained unchanged where downloaded. Third-party forms are not covered by the repository MIT licence. No broader redistribution or adaptation permission is asserted; consult the publisher notices before reuse beyond this test corpus. No completed respondent forms were collected.
