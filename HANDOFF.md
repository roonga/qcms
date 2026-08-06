# HANDOFF: AWAITING-HUMAN decide how the 051 theme sheet gets container-scoped (exit criterion 7 fence hit before any code was written)

**Task:** 058 - Preview theme island (`docs/features/058-preview-theme-island.md`)
**Branch:** `feat/058-preview-theme-island` (based on `dc40a83`, current `origin/main`)
**State:** no implementation committed. The tree is clean apart from this file. Nothing is red.
**Why parked:** the task cannot be built as specified without a change to the 051 token contract, which exit criterion 7 forbids and instructs the session to surface instead.

## The blocking fact

`packages/ui/src/theme.css` anchors **every** theme, mode, density, radius and font block on `:root`.
Verified exhaustively: 20 rule blocks, **zero** non-`:root` selectors in the file.

```
54,100,138,169  :root
112,122         :root.density-compact / .density-spacious
144,150,156     :root.radius-sharp / -rounded / -pill
208             :root.dark
249,288         :root[data-theme="harbor"] / [data-theme="harbor"].dark
329,368         :root[data-theme="sand"]   / .dark
409,448         :root[data-theme="plum"]   / .dark
501             :root.hc
542,549,556     :root[data-theme="harbor"|"sand"|"plum"].hc
```

`packages/ui/src/theme-components.css` carries the portal **HC treatment** (2px strong borders, shadow
flattening, 3px focus ring, separator contrast) on `:root.hc` at lines 181, 187, 200, 201, 210, 215, 231.
`fonts.css` is 23 x `:root.font-<key>`.

`:root` matches only the document root element. **Setting `data-theme="harbor"` and `class="dark"` on the
preview container matches nothing in the shipped stylesheets.** There is no `:where(:root, ...)`, no
`@scope`, no un-anchored duplicate, and no scope hook anywhere in the repo (grepped
`theme-scope`, `@scope`, `:where(:root` across `packages`, `apps`, `docs`: no matches).

So the central deliverable, quoted verbatim from the task file:

> custom properties and mode classes set on the island element, never on `:root`

is not expressible against the sheet as shipped. This is exactly the situation exit criterion 7 names:

> if scoping turns out to require a change in how the theme sheet is structured, stop and surface it;
> that is a 051-contract decision, not an admin rider.

## Two aggravating facts the decision needs

1. **Admin already loses the portal token values.** `apps/admin/app/globals.css:27-29` imports
   `packages/ui/src/theme.css` and then `./theme.css` (Cobalt). Cobalt re-declares the same custom
   properties on `:root` (`apps/admin/app/theme.css:11` light, `:61` dark, `:155` hc), later in source
   order at equal specificity. Inside admin, the entire portal token set therefore **already resolves to
   Cobalt values**, including tokens the island would not think to re-declare: Cobalt overrides
   `--radius-control: 4px`, `--radius-card: 8px`, `--radius-sm: 2px` against the portal's `6px/10px/4px`
   (`packages/ui/src/theme.css:139-141`). An island that re-declared only colours would still render
   portal controls with admin corner geometry. Criterion 1's "in no state does an island control resolve
   an admin-Cobalt token value" is a live risk across the whole token surface, not just colour.

2. **Admin does not import `theme-components.css` at all**, so the portal HC *treatment* required by
   criteria 2 and 4 is absent from admin entirely. Importing it is itself a decision with app-wide blast
   radius: it opens with a Tailwind v4 `@theme { }` block (line 43) that registers theme values globally,
   and its non-HC rules are anchored on `[data-rac]` / `[data-qcms-field]` (lines 62-167) - `[data-rac]`
   matches admin's own vendored a2ra chrome, so the import would restyle admin surfaces outside the
   preview. Its HC rules are `:root.hc`-anchored and would not scope even after importing.

## Options, with costs (recommendation last)

**A. Re-anchor the 051 sheet: `:root` -> `:where(:root, [data-qcms-theme-scope])`.**
Mechanical: 20 blocks in `theme.css`, 7 in `theme-components.css`, the generator at
`packages/ui/src/font-registry.ts:520`. Cascade-order safe: `:where()` contributes zero specificity, and
because the rewrite is uniform, every ordering the contract relies on is still decided by source order,
so the `:root` < `:root.hc` < `:root[data-theme="x"].hc` chain documented at `theme.css:494-496` and
asserted by `theme-tokens.test.ts` still holds (the `.hc` blocks sit after the theme light blocks, the
per-theme `.hc` accents last). Needs the selector parser at `packages/ui/src/theme-tokens.test.ts:78`
(`/(?<selector>:root[^{]*)\{(?<body>[^}]*)\}/gu`) widened, and `docs/theming.md` updated.
One caveat to weigh: dropping to zero specificity means Cobalt's `:root` blocks would win over the portal
blocks on the admin root by specificity as well as order, which is what admin wants anyway, but it also
means an adopter's own `:root` override now beats the portal sheet more easily than today.
Cost: small and contained. Cost is *governance*, not engineering: it changes the published contract of a
`@qcms/ui` sheet, so it is a 051 decision and probably its own task plus a changeset.

**B. Render the island in an iframe.** `:root` matches the iframe document's own root, so the shipped
sheets work unmodified, the HC treatment layer works, and two-way isolation becomes structural rather
than asserted (criterion 2 falls out for free). First paint is satisfiable by server-rendering the frame
document with the attribute and class already on `<html>`.
Cost: large. There is no iframe anywhere in admin today (grepped). The 034 seam is a plain
`<div className="qcms-preview qcms-preview-surface">` in `apps/admin/components/forms/draft-preview.tsx:202`
and `apps/admin/components/forms/version-view.tsx:121`, plus
`apps/admin/components/questions/question-preview.tsx`. Moving the render into a nested document means a
dedicated admin route or React-portal-into-iframe, auto-height, focus handling, cross-frame axe scanning,
and re-proving 032's interactivity (criterion 3) through the frame boundary. It also contradicts the
deliverable's literal "set on the island element" and the "without either surface being restructured"
clause.

**C. Runtime CSSOM copy.** Walk `document.styleSheets`, find the `CSSStyleRule` whose `selectorText` is
`:root[data-theme="harbor"].dark`, copy its declarations onto the island as inline custom properties.
Keeps values owned by `@qcms/ui` in source terms.
Cost: fails criterion 1 by construction (it runs after hydration, not at first paint); still no HC
treatment; must reimplement the cascade in JS; and it makes admin depend on the sheet's *selector text*
as an API, i.e. the same 051 coupling through the back door, but unversioned and untested.

**D. Build-time selector rewrite in admin's PostCSS**, filtered to the `@qcms/ui` source file. Achievable
without a new dependency (an inline plugin object). Same runtime result as A.
Cost: silently forks the contract for one consumer, so the sheet means one thing in the portal and another
in admin, with nothing in `packages/ui` recording it. Strictly worse than A for the same effect.

**Recommendation: A**, as a small, explicitly-scoped change to the 051 contract owned by a Code Owner
decision (or its own task), after which 058 becomes a straightforward admin-only task. B is the only
option that needs no `@qcms/ui` change at all, and it is worth choosing only if the contract must stay
frozen; if B is chosen, 058's deliverables and criteria 1-3 need rewording first, because they currently
describe A.

## Next step for whoever picks this up

1. Get the decision above. Do not proceed on inference; every option changes what 058's own criteria mean.
2. If A: land the re-anchoring separately (own task, changeset, `docs/theming.md` + `theme-tokens.test.ts`
   updated), then 058 is: scope attribute/class on `.qcms-preview-surface`, switcher UI, i18n labels,
   `QCMS_PORTAL_THEME` in `apps/admin/.env.example` (portal documents it at `apps/portal/.env.example:28-33`,
   reads it at `apps/portal/lib/server/theme.ts:97-99`, default `slate`), plus the radius/geometry
   re-declaration problem in fact 1 above and the `theme-components.css` question in fact 2.
3. Watch this landmine either way: `apps/admin/lib/questions/renderer-surface.test.ts:131` asserts the
   literal strings `"qcms-app-mode"`, `"QCMS_PORTAL_THEME"`, `"portalTheme"` and `"setTheme"` do **not**
   appear in `components/forms/draft-preview.tsx` or `components/forms/version-view.tsx`. The env read and
   the switcher's setter must live elsewhere.
4. Unrelated but worth knowing: the 051 set is `slate | harbor | sand | plum`
   (`apps/portal/lib/server/theme.ts:51`), and **`slate` has no `[data-theme="slate"]` block** - it is the
   bare `:root` default, so `data-theme="slate"` is inert and slate assertions must target the bare values.
