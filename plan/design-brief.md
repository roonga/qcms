# QCMS Visual Design Brief

QCMS has **two surfaces with different design mandates**, and this pass treats them separately:

- **Portal (external):** respondents see it, under the *adopter's* brand. It must be **adopter-themeable** (fonts, colors, radius swappable per deployment). We deliver a refined, brand-neutral baseline that any brand can sit on top of.
- **Admin (internal):** the adopter's own authors and operators use it; nobody re-brands it. So this pass **designs the actual admin components and screens** as a finished, opinionated tool with QCMS's own identity.

The component layer underneath both is fixed (a2-react-aria: react-aria primitives, shadcn-convention CSS custom-property tokens, Tailwind). This pass decides *values, type, and the composed admin experience*, not a new widget library.

---

## 1. What QCMS is (context for the designer)

An MIT-licensed, self-hosted TypeScript engine for questionnaires with deeply conditional logic (surveys, registration, insurance-style intake). Distributed shadcn-style: adopters scaffold and own their shell. Its identity is **correctness and trust**: the product non-negotiables are immutability, determinism, and auditability (published forms freeze, evaluation is reproducible, every answer change is on an audit ledger). The visual language should feel like infrastructure people running compliance-sensitive flows trust: precise, legible, calm.

---

## 2. Portal track (external, adopter-themeable)

**Audience:** anonymous or secure-link respondents on the public internet, seeing the *adopter's* brand.

**Mandate:** a **themeable respondent skin**. The deploying administrator customizes the look and feel at deploy time: fonts, colors, radius, spacing, all via tokens in one documented override point (shell globals). Theming is a product feature: `PROJECT_GOAL` already promises adopters theme via tokens, and each deployment brands the respondent experience as its own.

**Deliverables:**
1. A **refined, brand-neutral default theme** (light + dark, both AA) that reads as trustworthy and calm, and is neutral enough to wear any adopter's brand without redesign.
2. **Adopter customization surface:** the full shadcn token set plus **swappable fonts** (a self-hostable default the adopter can replace), documented as the single override point.
3. Applied preview of the portal flow (entry, step page, branch insert/remove, error/expired, completion) in both themes and with at least one alternate adopter brand, to prove the baseline flexes.

**Character:** calm, reassuring, fast, spacious. One task at a time. Brand-neutral: it should look considered on its own, but never so opinionated that an adopter's palette fights it.

---

## 3. Admin track (internal, designed components)

**Audience:** the adopter's form authors, question-library maintainers, and responses/webhook operators. Internal tool; not re-branded by adopters.

**Mandate:** because it is internal and fixed, this pass **designs the admin components and screens themselves** as a finished, opinionated tool carrying QCMS's own identity, built on the a2ra primitives. More latitude than the portal: this is our voice, not a neutral baseline.

**Deliverables:**
1. Designed **admin screens / component patterns** for: shell + 2FA, question library, form builder + condition editor, publish / preview / versions / links, responses + erasure + webhook ops, and the agent panel. (Structure per `docs/wireframes/`; this pass is the visual + interaction skin over that fixed structure.)
2. Fixed **light + dark** QCMS admin theme, both AA. No adopter re-brand required.
3. Applied previews on the three densest screens (form builder, responses browser, publish/preview) with real fixture content, both themes.

**Character:** professional, precise, dense but breathable, operable at a glance. Data-forward: the admin shows a lot of monospaced truth (question IDs, versions, content hashes, ledger timelines, JSON diffs, the condition editor), so technical typography is first-class identity, not an afterthought.

**Note on ADR-22:** "designing components" here means designing the admin's **composed UI patterns** (the builder, condition editor, responses browser, dialogs) on top of the a2ra primitive set, not authoring a second component library. If the admin genuinely needs a primitive a2ra lacks, that remains an upstream a2ra contribution (ADR-22). The design pass owns the composed admin experience; a2ra owns the primitives.

---

## 4. Shared hard constraints (both surfaces)

- **Component layer is a2-react-aria** (react-aria + shadcn tokens + Tailwind, ADR-22). Deliverables are token values, type, and composition, not new primitives.
- **WCAG 2.2 AA in both themes, on both surfaces (non-negotiable):** 4.5:1 text / 3:1 large + UI contrast, a visible focus state everywhere, and **color never the sole signal** (states also carry text or icon). Note the measured ratio for each token pair.
- **Self-hostable typography** (runs offline / behind a VPN; ships to adopters). The portal default font must be adopter-swappable; the admin font is our fixed choice.
- **Semantic color** (good / warning / critical for delivery state, validation, flagged responses, dead-letters) is separate from the brand accent and must pass AA.
- **Responsive, and the portal is mobile-first (critical).** Respondents fill forms on phones, so the portal must be **fully responsive, mobile-first, and touch-friendly**: comfortable tap targets (min 44px), no horizontal body scroll, single-column flow, controls and error summaries that work one-handed. The admin is desktop-primary (an authoring tool) but must stay usable and unbroken down to tablet widths, with dense tables scrolling inside their own container. Every preview is shown at a **narrow (~390px) and a wide viewport**.

---

## 5. Character summary

| | Portal | Admin |
|---|---|---|
| Whose brand | The adopter's (themeable) | QCMS's own (fixed) |
| Design output | Refined neutral baseline + theming system | Designed screens / component patterns |
| Customization | Adopter-overridable fonts + tokens | Fixed by us, light + dark |
| Feel | Calm, reassuring, spacious, brand-neutral | Precise, dense, data-forward, confident |

---

## 6. Handoff references

- Wireframes (fixed structure, both surfaces): `docs/wireframes/` and the [042 review page](https://claude.ai/code/artifact/0263ae87-8e2c-4462-94e1-e824e61c6288).
- Token / component reference: the a2-react-aria styling guide (`@a2ra/core`), the authority for variable names and styling conventions.
- Stack facts: React 19, Tailwind, vendored a2ra components (ADR-22, `docs/PROJECT_GOAL.md`).

## 7. Open questions for the design pass

- Portal default: propose a brand-neutral accent that stays legible under an adopter's overrides on both grounds.
- Admin: propose QCMS's own brand accent (single, confident, AA on both grounds) since there is no established brand color yet.
- Font licensing for the chosen self-hostable faces (portal default + admin).
- How much the portal default and the admin theme visually relate (shared DNA vs deliberately distinct).
