# US health insurance claim (CMS-1500)

- Domain: insurance
- Jurisdiction: United States
- Language: English
- Publisher: Centers for Medicare & Medicaid Services / NUCC
- Collection status: **downloaded**
- Collected/checked: 1 November 2026 (Australia/Sydney)
- Official source: [Centers for Medicare & Medicaid Services / NUCC](https://www.cms.gov/Medicare/CMS-Forms/CMS-Forms/cms-forms-items/cms1188854)

## Collected material and limitations

Four-page CMS-hosted PDF containing sample/claim pages; SAMPLE watermarks are part of the source. The printed form revision is 02-12. This is provider billing rather than a patient intake survey; preserve page variants without merging duplicate questions blindly.

| Asset                     | Pages | Format / fields                    | Original download                                                                        |
| ------------------------- | ----: | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `source.pdf` (not stored) |     4 | AcroForm; 0 AcroForm field entries | [Publisher file](https://www.cms.gov/Medicare/CMS-Forms/CMS-Forms/downloads/cms1500.pdf) |

Page counts and PDF form types were checked locally with Poppler. AcroForm field counts are library observations, not question counts; null or missing counts do not mean there are no questions. Checksums and exact retrieval URLs are in [the corpus manifest](../manifest.json).

## Suggested test scenarios

- Separate patient, insured person, referring provider, billing provider and service facility.
- Exercise six service lines, diagnosis pointers, procedure codes, units and monetary amounts.
- Keep employment/accident/other-insurance branches and assignment/signature fields distinct.

These are manual evaluation targets, not implemented tests or validated QCMS definitions. Compare any future extraction with the original wording, answer choices and explicit routing. Use synthetic answers only.

## Rights and provenance

Original publisher material is retained unchanged where downloaded. Third-party forms are not covered by the repository MIT licence. No broader redistribution or adaptation permission is asserted; consult the publisher notices before reuse beyond this test corpus. No completed respondent forms were collected.
