# QCMS - Project Goal

**Status:** authoritative
**License:** MIT · **Companion documents:** `ARCHITECTURE.md` · `IMPLEMENTATION_PLAN.md` · `DOMAIN_SCHEMA.md`

---

## 1. Vision

QCMS is an MIT-licensed, TypeScript, open-source engine for questionnaires, surveys, and registration flows with **deeply conditional logic** - the answer to one question determines which questions follow (the motivating example: a vehicle insurance quote, where "any at-fault accident in the last 3 years?" opens a follow-up branch).

It is distributed in the **shadcn ethos**: adopters do not install a product, they scaffold an application into their own repository and own the source. The invariant machinery - domain model, rules engine, publish compiler, migrations - ships as versioned npm packages they upgrade like any dependency.

The project is also a proof point: **a single developer with AI leverage can ship what used to take a SaaS team.**

## 2. Audiences

| Audience                 | What they do                                                                                                                 | Surface                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Form authors**         | Curate a governed question library; compose forms; define branching rules; publish and version; review responses; export     | Admin app (VPN/internal)                           |
| **Respondents**          | Complete flows anonymously or via signed secure links; resume in-progress sessions; on any device, with assistive technology | SSR portal (public)                                |
| **Downstream systems**   | Receive submissions via signed webhook; pull via CSV/JSON export or the documented read-only reporting view in Postgres      | Webhook · export · `reporting.*` views             |
| **Adopters / operators** | Scaffold, theme, extend, and self-host the system with a small-team operability budget                                       | `create-qcms-app` scaffold · docker-compose · docs |

## 3. Non-negotiable properties

These three properties shape every architectural decision and are never traded away:

1. **Immutability.** Published form versions are frozen forever. Sessions pin the version they started on and never migrate. Referenced question versions never change.
2. **Determinism.** The serving path contains no LLM and no nondeterministic component. Same form version + same answers = same flow and same UI, forever. Rule evaluation is a pure function whose semantics are versioned with each snapshot.
3. **Auditability.** The system can always answer: _what was asked, what was shown, what was answered, and when it changed._ Immutable snapshots store both the domain definition and the compiled UI; answers are an append-only ledger.

Two further properties are first-class commitments rather than differentiators: **accessibility** (WCAG 2.2 AA, built during development, verified per release with automated and manual passes) and **internationalization** (ADR-27): **no user-facing string is ever hardcoded** - both the portal and the admin render every string through the app's i18n catalog or `LocalizedText` (authored content), and dates, numbers, and currency are formatted locale-aware via `Intl`. The system is multiple-language-capable; the initially shipped translation set may be small, but nothing is hardcoded. **Typography is held to the same bar (mandate):** every font QCMS offers - the default plus every built-in accessibility/visibility option - must be **open-licensed and self-hostable** (OFL / Apache-2.0 or equivalent permissive; no proprietary or paid fonts, no runtime font-CDN dependency), so any deployment can legally ship and self-host it. **Google Fonts is the canonical source** - its whole library qualifies, so prefer it. A font outside Google Fonts may be offered only if it meets the same bar and its license notice is documented alongside the self-hosted asset (e.g. OpenDyslexic, OFL-1.1). Offered fonts follow accessible-typography guidance: generous x-height, unambiguous letterforms (distinct `I`/`l`/`1`, non-mirrored `b`/`d`), adequate weight, plus broad script coverage for i18n; and the portal honors the WCAG 1.4.12 spacing floors (>= 16px body, >= 1.5 line-height, >= 0.12em letter-spacing, >= 0.16em word-spacing).

## 4. Success criteria

### Launch (end of Phase 3)

- A person who did not build the system can, following only the README: scaffold the app, run it with docker-compose, author and publish a branching form, complete it as a respondent, and receive the export and signed webhook. **This is the launch gate.**
- The kitchen-sink reference form (every question type) and the insurance fixture (branching) pass: automated axe checks, Lighthouse accessibility 100 on flow pages, and a logged manual NVDA + VoiceOver pass.
- A respondent completes a flow on a mid-tier phone over a throttled network with SSR first paint.
- The full loop runs on the solo topology: four containers - portal, admin, API, Postgres - with TLS/ingress supplied by the operator (ADR-20).
- Erasure of a respondent's data is possible via a documented, tested path (ADR-17).

### Post-launch (Phase 4, demand-ordered)

Adoption signals decide sequencing, not the roadmap: OTP/social login, question-library cascade UX (impact analysis), `/api/v1` with scoped tokens and generated OpenAPI, locale-switching UX, adaptive agent serving behind the compiler seam, named custom themes, version-targeted public and secure links, file-upload question type, and Bun runtime on evidence.

## 5. Scope boundaries (the cut-line)

Launch **includes**: the seven core question types (short text, long text, number, date, boolean, single choice, multi choice); the closed rules DSL; question-level versioning with manual pinning; anonymous + secure-link access; append-only answers with resume; submission lock; signed webhook with transactional outbox; CSV/JSON export; reporting view; retention sweep and hard-erasure path; admin authoring with structured condition editing; **flag-gated agent-assisted form building (ADR-25 - built for launch, off the launch gate)**; **full internationalization on both apps** (no hardcoded user-facing text; locale-aware dates/numbers/currency; multiple-language-capable, ADR-27); single-tenant deployments.

Launch **excludes** (recorded as `phase-4` issues, never built early): impact analysis / breaking-change detection, `/api/v1`, large shipped locale-translation sets and a runtime locale-switcher UX (the i18n machinery is launch scope, ADR-27; additional translations are demand-ordered), multi-tenancy, OTP/social auth, runtime agent flows **in the serving path** (adaptive flows - the `StepResolver` seam stays reserved), the named custom-theme editor, version-targeted public and secure links, file-upload question type, and a visual drag-and-drop condition builder beyond the structured editor.

**The cut-line is enforced at review, not remembered.** An itch is written down as an issue labeled `phase-4`, not scratched.

## 6. Decision record

The decision record lives in `docs/adr/` (index: `docs/adr/README.md`), split by surface:

- `docs/adr/core.md` - decisions binding the engine, the data model, the API, the platform, both frontends, or the development process
- `docs/adr/portal.md` - decisions binding only the respondent portal
- `docs/adr/admin.md` - decisions binding only the admin

Decisions are surface-specific unless explicitly shared (ADR-26). The **admin** is an internal authoring and operations tool; the **portal** is the public respondent experience. A choice made for one surface does not automatically apply to the other. ADR numbering is stable across the split: `ADR-NN` cites the same decision it always has.

## 7. Constraints

- **Team:** one developer, part-time to full-time, using agentic AI workflows for leverage. Every stage must land a meaningful, testable increment; exit criteria gate stages, not dates.
- **Stack (fixed by ADRs):** Node LTS · pnpm + Turborepo · Zod as the single schema language · Hono (vertical slices, fetch-pure handlers) · Next.js portal (SSR + strict BFF) · Next.js admin (separate app) · Postgres + Drizzle · better-auth · a2-react-aria as the only UI component stack (`@a2ra/core` pinned + vendored components + Tailwind for their token-based styles, ADR-22) · TanStack Query (admin server-state, ADR-26) · Vitest · Docker. All components open source, vendor-agnostic, multi-cloud.
- **Operability budget:** the solo deployment is four containers including the database (portal, admin, API, Postgres - ADR-20; TLS/ingress is operator infrastructure). If a feature demands a fifth standing service, it is probably out of scope.
- **Discipline rules R1-R8** (defined in `PROJECT_INSTRUCTIONS.md`) are never violated and never relitigated. R3's append-only clause is amended by ADR-17 as noted.

## 8. What this project is not

Not a SaaS (though a multi-tenant derivative remains a documented recipe). Not a form-painting WYSIWYG competing on drag-and-drop. Not an analytics product - it hands clean data to tools that are. Not an LLM-at-runtime product - agents may assist _authoring_ (launch, flag-gated, ADR-25); they never sit in the serving path.
