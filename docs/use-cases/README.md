# Real-world form test corpus

Collected on **1 November 2026 (Australia/Sydney)** for QCMS, a questionnaire engine with conditional routing and agent-assisted authoring. This collection supplies external source documents for future import, extraction and form-generation evaluations. It does not create QCMS forms, schemas, answer datasets or application code.

**16 cases have local material: 18 original PDFs and two HTML captures.** Of these, 14 cases contain complete source form/questionnaire packs; the Australian passport case contains B11 plus PC8 guidance (not PC8 itself), and the council survey captures only its first step. Three further cases are explicitly link-only leads. PDF packs include instructions, worksheets, sample pages and publication front matter; a PDF page is not necessarily a page of questions.

The locally available sources cover Australia, Canada, New Zealand, the United States, the United Kingdom and international WHO material, with English, French and Simplified Chinese. Hong Kong / Traditional Chinese is a link-only lead.

> **The publisher originals are not committed.** Each case folder holds only our own notes. Retrieve an original from the publisher URL in the case README or in `manifest.json` (`source_url`) and check it against the `sha256` recorded there. Where this collection says a file is "stored" or "local", it means it was held at collection time.

## Catalogue

Status: **downloaded** = source form pack stored locally; **partial** = useful material with a documented coverage gap; **link-only** = no local form asset. Each folder has provenance, limitations and suggested test scenarios.

| Form / case                                                                                            | Domain     | Jurisdiction               | Status     | Local assets |
| ------------------------------------------------------------------------------------------------------ | ---------- | -------------------------- | ---------- | ------------ |
| [Australian passport application (PC8) and B11 declaration](australian-passport-application/README.md) | government | Australia                  | partial    | 3            |
| [NSW driver licence application (Form 1001)](nsw-driver-licence/README.md)                             | government | Australia                  | downloaded | 1            |
| [Canadian adult general passport application (PPTC 153 / 154)](canadian-adult-passport/README.md)      | government | Canada                     | downloaded | 2            |
| [US application for naturalization (N-400)](us-naturalization-n400/README.md)                          | government | United States              | downloaded | 1            |
| [New Zealand tax code declaration (IR330)](nz-tax-code-ir330/README.md)                                | government | New Zealand                | downloaded | 1            |
| [US employee withholding certificate (W-4)](us-tax-withholding-w4/README.md)                           | government | United States              | downloaded | 1            |
| [Australian Medicare enrolment (MS004)](australian-medicare-enrolment/README.md)                       | health     | Australia                  | downloaded | 1            |
| [NHS Logan Practice new-patient questionnaire](nhs-new-patient-questionnaire/README.md)                | health     | United Kingdom (Scotland)  | downloaded | 1            |
| [US health insurance claim (CMS-1500)](us-health-insurance-cms1500/README.md)                          | insurance  | United States              | downloaded | 1            |
| [ahm travel insurance claim](ahm-travel-insurance-claim/README.md)                                     | insurance  | Australia                  | downloaded | 1            |
| [Australian national private patient hospital claim](australian-hospital-insurance-claim/README.md)    | insurance  | Australia                  | downloaded | 1            |
| [US American Community Survey (ACS)](us-american-community-survey/README.md)                           | survey     | United States              | downloaded | 1            |
| [US BRFSS health survey questionnaire](us-brfss-health-survey/README.md)                               | survey     | United States              | downloaded | 1            |
| [WHO-5 wellbeing survey](who5-wellbeing-survey/README.md)                                              | survey     | International              | downloaded | 2            |
| [Course evaluation survey](course-evaluation-survey/README.md)                                         | survey     | United States (California) | downloaded | 1            |
| [Council customer satisfaction survey](uk-customer-satisfaction-survey/README.md)                      | survey     | United Kingdom (England)   | partial    | 1            |
| [New Zealand adult passport application (PAS310)](nz-adult-passport/README.md)                         | government | New Zealand                | link-only  | 0            |
| [CAHPS adult Medicaid health-plan experience survey 5.1](cahps-health-plan-experience/README.md)       | survey     | United States              | link-only  | 0            |
| [Bupa Hong Kong clinical insurance claim](bupa-health-insurance-claim/README.md)                       | insurance  | Hong Kong                  | link-only  | 0            |

## Evaluation coverage

| Capability to evaluate                                     | Useful starting sources                                   |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| Simple ratings, ordered scales and comments                | Course evaluation; council satisfaction first step; WHO-5 |
| Explicit skip instructions and conditional sections        | Medicare MS004; ahm travel claim; ACS; BRFSS              |
| Repeated people and household relationships                | Medicare; ACS; N-400                                      |
| Repeated service lines, money and coded values             | CMS-1500; hospital claim; ahm claim                       |
| Eligibility, evidence and multiple signatory roles         | NSW licence; Canadian passport; N-400; B11                |
| Decision flowcharts and worksheet/reference separation     | IR330; W-4                                                |
| Multilingual text and differing editions                   | Canadian English/French; WHO-5 English/Chinese            |
| XFA and extraction failure handling                        | NSW licence; Canadian passports; N-400; W-4               |
| Long interviewer scripts and non-answer codes              | BRFSS                                                     |
| Raw HTML labels, options, required flags and length limits | Council satisfaction first step                           |

Start with course evaluation and WHO-5, then NHS intake and Medicare, then ahm/ACS, and finally BRFSS and XFA-heavy government forms. Suggested scenarios are evaluation ideas, not assertions that QCMS already supports the source's full behaviour. No forms have been imported or generated as part of collection.

## Provenance and verification

[manifest.json](manifest.json) lists every case and downloaded asset, original and final download URL, retrieval date, byte size, SHA-256, PDF page count and observed PDF form type. Original files are not rewritten, repaired, flattened or filled. Publisher revisions can differ from search-index snippets; the stored bytes and checksum define this fixture.

All 18 PDFs passed Poppler metadata inspection and first-page rendering; their rendered first pages were visually checked together. This was a collection/integrity check, not exhaustive review of every page or validation of every route. Some XFA PDFs cannot be decrypted/extracted by pypdf despite rendering successfully. Field counts are not question counts. HTML snapshots were checked for expected visible labels; linked assets and later steps are not bundled. Raw HTML may still reference live services: use it for parsing and do not submit the captured form.

The Australian PC8 source explains that a blank application is not available for printing from the portal. B11 is a genuine blank supplementary form; the saved embassy guidance is not a substitute for PC8. New Zealand PAS310, CAHPS and Bupa Hong Kong remain link-only because their servers blocked direct collection. No challenge/error HTML was accepted as a PDF.

## Using and extending the corpus

1. Read a case README before using its assets; note edition, scope, status and publisher rights.
2. Evaluate extracted labels, answer options, grouping and explicit routing against the original. Keep instructions, office-use blocks, declarations and calculated worksheets distinct.
3. Use synthetic answers for branch exploration. Store any future expected schemas or results separately and identify the exact source checksum they target.
4. For an update, download from the official source, inspect the file type/content and PDF pages, then update the manifest and case README together. Do not silently replace a fixture during an evaluation run.

## Third-party rights

The repository's MIT licence does **not** apply to these third-party source files. Publisher copyright, attribution and use conditions remain in force. Public availability is not a claim of unrestricted redistribution. The English WHO-5 publication states CC BY-NC-SA 3.0 IGO, which includes noncommercial and share-alike conditions; its Chinese translation has separate embedded credits. Consult original notices before reusing or adapting materials outside this test corpus. These are blank forms, informational copies and guidance, not completed personal records.
