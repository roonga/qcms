# 042 - UI wireframes (lo-fi pass, human-gated)

**Stage:** 7 (pre-work) · **Scope:** `docs/wireframes/` · **Depends on:** 027 (API contracts final - wireframes drawn earlier would drift)
**Runs before:** 029 and 031–035, 041 (each UI task references its wireframe file as a contract). Numbered out of sequence like 040/041 - see `features/README.md`.
**References:** `ARCHITECTURE.md` §6 · **ADR-22** (component names come from the a2ra registry) · `AGENTIC_DEVELOPMENT.md` §1.8 (human-in-the-loop points)

## Context

The design system is already decided (ADR-22: upstream tokens, vendored a2ra components), so there is no mockup phase - fidelity comes later from real components rendering real fixtures. What must be decided *before* UI tasks run is structure: information architecture, region layout, states, and interactions per screen.

**The wireframes were drafted up front (2026-07-19) in the plan bundle** - `wireframes/` alongside `features/`, copied to `docs/wireframes/` by 001. They are marked **Draft (pre-027)** because they were written before the API contracts froze. This task is therefore a **verify-revise-sign-off pass**, not a writing pass.

## Deliverables

- **Verification pass over the pre-drafted files:** every Interactions entry checked against the 027 OpenAPI documents (paths, bodies, error codes); every Regions component name checked against the a2ra registry as it stands at execution time (the known-gaps table in the format spec updated - gaps may have landed upstream by then); drift fixed in place; status headers flipped from `Draft (pre-027)` to `Signed off <date>` as sign-offs land.
- **Format spec** (`docs/wireframes/README.md` - pre-drafted), binding for every wireframe file:
  - **The ASCII sketch is illustrative; the inventories are normative.** No requirement may live only in box geometry - models (and humans skimming) must be able to build the screen from the inventories alone. State this rule in the spec verbatim.
  - Each file contains: an ASCII layout sketch (orientation aid, ≤2 nesting levels, labeled regions); a **Regions (normative)** tree - containment, content, and the **real a2ra registry component name** for every element (`table`, `dialog`, `menu`, `tabs`, `text-field`, …); a **States (normative)** list (empty / loading / error / branch-change / etc.); an **Interactions** list (what each action calls, per the 027 OpenAPI docs); and **A11y notes** (focus targets, announcements, keyboard paths - feeding 030's policies).
- **Wireframe files** (pre-drafted - verify and revise, don't rewrite unless wrong), one per screen area:
  - `portal-flow.md` - entry (anonymous + secure-link), step page, branch insert/remove, error/expired, completion.
  - `admin-shell.md` - nav, sign-in, 2FA enrollment/challenge (031).
  - `admin-question-library.md` - list, detail/versions, editor per type (032).
  - `admin-form-builder.md` - steps rail, step editor, pin management, condition editor + live validation, form settings panel (033).
  - `admin-publish-preview.md` - publish flow + errors, preview, version history, secure links (034).
  - `admin-responses-ops.md` - response browser, detail + ledger, export, erasure, webhook operations + dead letters (035).
  - `admin-agent-panel.md` - chat panel, proposal diff, accept-into-draft, provenance marker (041).
- **Human sign-off:** Ravi reviews and approves each file (a checked sign-off line with date inside the file). This is a §1.8 human-in-the-loop point - an agent prepares, a human decides.
- The **Wireframe:** references in the UI task files (029, 031–035, 041) already point at the filenames above - verify they resolve once the files exist; fix any drift here.

## Exit criteria

1. Every screen area above has a wireframe file conforming to the format spec; no requirement exists only in ASCII geometry (spot-check: build each Regions tree without looking at the sketch).
2. Component names in the Regions trees exist in the a2ra registry or are flagged as the known upstream gaps (011's cross-repo issues) - no invented components.
3. All files carry Ravi's dated sign-off.
4. UI task files updated with their wireframe references.

## Out of scope

Visual design decisions beyond structure (tokens/theming are upstream's, ADR-22), pixel mockups or external design tools (the repo is the source of truth), any implementation, changes to API contracts (a wireframe revealing an API gap is a blocking issue on the relevant slice task, not a fix here).
