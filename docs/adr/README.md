# QCMS decision records

**Status:** authoritative. This directory is the decision record; `docs/PROJECT_GOAL.md` §6 points here.

Decisions are surface-specific unless explicitly shared (ADR-26). The **admin** is an internal authoring and operations tool; the **portal** is the public respondent experience. A choice made for one surface does not automatically apply to the other, which is why the record is split:

- [`core.md`](core.md) - decisions binding the engine, the data model, the API, the platform, both frontends, or the development process
- [`portal.md`](portal.md) - decisions binding only the respondent portal
- [`admin.md`](admin.md) - decisions binding only the admin

ADR numbering is stable across the split: `ADR-NN` cites the same decision it always has, wherever the text now lives. The operational companions remain `docs/portal-constraints.md` and `docs/admin-constraints.md` ("what binds this surface"); this record holds the decisions those documents cite.

Each record carries a **Status** line (implemented; amended, with date and task or issue; partly built; not built, with owning task; process). A **Note** records verified drift between the decision text and the code as of the 2026-08-31 review; an item that needs a Code Owner decision is marked **flagged**.

## Index

| ADR    | Title                                   | Doc    |
| ------ | --------------------------------------- | ------ |
| ADR-01 | Domain-first compiled UI                | core   |
| ADR-02 | Versioned question library              | core   |
| ADR-03 | Closed rules DSL                        | core   |
| ADR-04 | Single-tenant core                      | core   |
| ADR-05 | Owned shell, versioned invariants       | core   |
| ADR-06 | Separate admin and respondent identity  | core   |
| ADR-07 | Pinned sessions and submission lock     | core   |
| ADR-08 | Separate frontends, shared renderer     | core   |
| ADR-09 | Route groups are topology controls      | core   |
| ADR-10 | Reporting before public API             | core   |
| ADR-11 | Localizable content model               | core   |
| ADR-12 | Accessible abuse controls               | portal |
| ADR-13 | Fetch-pure vertical slices              | core   |
| ADR-14 | Step resolver seam                      | core   |
| ADR-15 | Runtime baseline                        | core   |
| ADR-16 | Forward-only rule evaluation            | core   |
| ADR-17 | Erasure, retention, and outbox copies   | core   |
| ADR-18 | Serve the stored audit copy             | core   |
| ADR-19 | Launch delivery split                   | admin  |
| ADR-20 | Four-container solo topology            | core   |
| ADR-21 | Multi-choice comparison                 | core   |
| ADR-22 | One UI component stack                  | core   |
| ADR-23 | Test layers                             | core   |
| ADR-24 | Typed deployment flags                  | core   |
| ADR-25 | Agent-assisted authoring only           | admin  |
| ADR-26 | Different frontend decisions by surface | core   |
| ADR-27 | Internationalization in both apps       | core   |
| ADR-28 | Explicit portal navigation              | portal |
| ADR-29 | One root conductor                      | core   |
| ADR-30 | Portal theming                          | portal |
| ADR-31 | Answer commitment                       | portal |
| ADR-32 | Authored validation messages            | core   |
| ADR-33 | Answer retraction                       | core   |
| ADR-34 | OpenTelemetry baseline                  | core   |
| ADR-35 | API-only database access                | core   |
| ADR-36 | Authored boolean labels                 | core   |
| ADR-37 | Port allocation                         | core   |
| ADR-38 | Theme scope carrier                     | core   |
| ADR-39 | Link version targeting                  | portal |
