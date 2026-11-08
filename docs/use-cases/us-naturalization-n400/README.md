# US application for naturalization (N-400)

- Domain: government
- Jurisdiction: United States
- Language: English
- Publisher: US Citizenship and Immigration Services
- Collection status: **downloaded**
- Collected/checked: 1 November 2026 (Australia/Sydney)
- Official source: [US Citizenship and Immigration Services](https://www.uscis.gov/n-400)

## Collected material and limitations

Fourteen-page edition 01/20/25. Original is an encrypted XFA PDF. Poppler validates and renders it, but pypdf reports Invalid padding bytes; acroform_fields is null for that reason. No decryption, repair or flattening was applied.

| Asset                     | Pages | Format / fields | Original download                                                                    |
| ------------------------- | ----: | --------------- | ------------------------------------------------------------------------------------ |
| `source.pdf` (not stored) |    14 | XFA             | [Publisher file](https://www.uscis.gov/sites/default/files/document/forms/n-400.pdf) |

Page counts and PDF form types were checked locally with Poppler. AcroForm field counts are library observations, not question counts; null or missing counts do not mean there are no questions. Checksums and exact retrieval URLs are in [the corpus manifest](../manifest.json).

## Suggested test scenarios

- Exercise eligibility-dependent sections, including marriage and military eligibility.
- Identify repeated name, residence, employment, travel and family information without turning instructions into questions.
- Preserve declarations and distinct applicant, interpreter and preparer roles; report unsupported PDF extraction explicitly.

These are manual evaluation targets, not implemented tests or validated QCMS definitions. Compare any future extraction with the original wording, answer choices and explicit routing. Use synthetic answers only.

## Rights and provenance

Original publisher material is retained unchanged where downloaded. Third-party forms are not covered by the repository MIT licence. No broader redistribution or adaptation permission is asserted; consult the publisher notices before reuse beyond this test corpus. No completed respondent forms were collected.
