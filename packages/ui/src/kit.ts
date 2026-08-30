/**
 * `@qcms/ui/kit` - the shared admin UI kit (task 031).
 *
 * The admin app's own screens are **ordinary React** (ARCHITECTURE §6): A2UI
 * documents and `A2Renderer` appear in the admin only inside the preview pane
 * (task 034), never for the admin's own chrome. But ADR-22 allows exactly one
 * component stack across both frontends, and vendored a2-react-aria sources live
 * in **this** package and nowhere else. So the admin's tables, forms, dialogs and
 * alerts come from here: the same vendored files the A2UI renderer uses, exported
 * on their own subpath as plain React components.
 *
 * Task 032 adds the four input primitives the question editor needs (`Select`,
 * `Checkbox`, `NumberField`, `DatePicker`). They are the same vendored files the
 * renderer already maps A2UI nodes onto, so an operator authoring a `number`
 * constraint types into literally the component a respondent will answer with.
 * Nothing was vendored to add them: they were already here, reachable only by the
 * renderer's registry, and the barrel is what makes them reachable by an admin
 * screen as well.
 *
 * That is the whole content of this module, and the restraint is deliberate:
 *
 * - **No wrappers.** Every export is the vendored component itself, so an admin
 *   screen and a rendered A2UI step get literally the same implementation and the
 *   same token-driven styling. A QCMS-flavoured wrapper layer would be a second
 *   design language by accretion, which is what ADR-22 exists to prevent.
 * - **No schemas.** The `*Schema` exports and `*Node` types belong to the A2UI
 *   document format; admin screens pass props, so re-exporting them here would
 *   invite an admin screen to grow an A2UI document. `registryForSpecVersion` (the
 *   root export) stays the only door to the renderer.
 *
 * Styling is Tailwind utilities over the four ADR-30 token groups, single-sourced
 * upstream, so the host app must load `@qcms/ui/theme.css` (or its own file that
 * defines the same custom properties) for these to render as intended.
 *
 * Everything here is interactive react-aria (hooks, context), so a Next.js
 * consumer imports it from a `"use client"` module. The admin does that once, in
 * `components/kit.tsx`, and its server components import from there.
 *
 * ## The menu primitives, and why they are not the vendored `Menu` (task 032)
 *
 * Task 032 rebuilds the admin topbar's trailing group as two popup menus: an
 * icon-only appearance trigger and a circular initials avatar. `menu` was vendored
 * from the pinned registry for it (`src/components/a2ui/menu/`, `a2ra diff` clean)
 * and is exported below, because the kit is the one door to a vendored component.
 * The topbar does **not** compose it, and the reason is its props rather than a
 * preference: `Menu` takes `triggerLabel?: string` and renders its own bordered
 * pill, and its items are `{ id, label: string }`. The frozen design card
 * (`plan/admin-theme/ds-navbar.html`) needs a trigger that is an SVG glyph or an
 * initials disc with an `aria-label`, a menu with its own `aria-label`, a checked
 * row carrying a check glyph beside its text, a non-interactive "Signed in as"
 * header and a separator. None of those are reachable through that prop surface,
 * and ADR-22 forbids editing a vendored file to reach them.
 *
 * So the topbar composes react-aria-components directly, re-exported here. That is
 * the stack's own foundation, not a second component library: ADR-22's lint fence
 * names it explicitly ("use the vendored components (src/components/a2ui) **or**
 * react-aria-components"), the vendored `Menu` is itself a thin composition of
 * exactly these primitives, and routing them through this module keeps
 * `react-aria-components` an import of this package alone, which is the property
 * ADR-22 actually protects. The keyboard contract the card documents (Enter, Space
 * or Arrow Down opens; arrows navigate; Escape closes and returns focus) comes from
 * `MenuTrigger` either way - it is the same machinery, reached one layer lower.
 *
 * Closing the gap upstream (a `trigger` slot, a menu `aria-label`, richer item
 * content, a header slot and a separator on the registry's `Menu`) is tracked as a
 * cross-repo issue pair, per ADR-22's rule that a shortfall in a vendored component
 * is fixed in a2-react-aria and never forked here: `roonga/a2-react-aria#75`
 * upstream, `roonga/qcms#234` here for the adoption that follows it.
 */

export { Alert } from "./components/a2ui/alert/index.ts";
export { Breadcrumb } from "./components/a2ui/breadcrumb/index.ts";
export type { BreadcrumbItem } from "./components/a2ui/breadcrumb/index.ts";
export { Button } from "./components/a2ui/button/index.ts";
export { Card } from "./components/a2ui/card/index.ts";
export { Checkbox } from "./components/a2ui/checkbox/index.ts";
export { DatePicker } from "./components/a2ui/date-picker/index.ts";
export { Dialog } from "./components/a2ui/dialog/index.ts";
export { Form } from "./components/a2ui/form/index.ts";
export { Menu } from "./components/a2ui/menu/index.ts";
export type { MenuItemEntry } from "./components/a2ui/menu/index.ts";
export { NumberField } from "./components/a2ui/number-field/index.ts";
export { Select } from "./components/a2ui/select/index.ts";
export type { SelectItem } from "./components/a2ui/select/index.ts";
export { Table } from "./components/a2ui/table/index.ts";
export type { TableColumn, TableRow } from "./components/a2ui/table/index.ts";
export { Text } from "./components/a2ui/text/index.ts";
export { TextField } from "./components/a2ui/text-field/index.ts";

/**
 * The popup-menu primitives, named for what a host composes rather than for their
 * upstream identifiers, so an admin screen never has two things called `Menu`.
 * They carry no styling of their own: the host supplies class names, which is how
 * the topbar wears the card's own shapes without a variant layer growing here.
 */
export {
  Button as MenuTriggerButton,
  Menu as MenuList,
  MenuItem,
  MenuTrigger,
  Popover as MenuPopover,
  Separator as MenuSeparator,
} from "react-aria-components";

/**
 * The tab primitives, for the same reason and by the same route as the menu ones above.
 *
 * The pinned registry has no `Tabs` to vendor, and ADR-22's lint fence names the
 * alternative explicitly: "use the vendored components (src/components/a2ui) **or**
 * react-aria-components". So a host that needs the APG tabs pattern - a roving tabindex,
 * arrow-key movement between tabs, `aria-controls` wired to the panel, and the "tab 2 of
 * 3, selected" announcement that comes with the roles - composes it from the stack's own
 * foundation here rather than hand-rolling that keyboard contract per screen.
 *
 * Unstyled on purpose, exactly as the menu primitives are: the host supplies class names,
 * so no variant layer accumulates in this package for a component the registry may later
 * ship its own opinion about. Closing the gap upstream is the ADR-22 route if one arrives.
 */
export { Tab, TabList, TabPanel, Tabs } from "react-aria-components";

/**
 * The combobox primitives: a text input that FILTERS a list, by the same route and for the
 * same reason as the menu and tab primitives above.
 *
 * The pinned a2-react-aria registry ships a `select` and no combobox (checked against the
 * `a2ra.json` pin), so there is nothing to vendor and ADR-22's own wording names the
 * alternative: "use the vendored components (src/components/a2ui) **or**
 * react-aria-components". A picker over a list too long to scan is not a Select with extra
 * steps - it is the APG combobox pattern, which carries a roving `aria-activedescendant`,
 * the "N results available" announcement and the input-to-listbox relationship that a
 * hand-rolled filter over a `Select` would have to reinvent and would get subtly wrong.
 *
 * Aliased, because the bare names collide with the vendored components and with the menu
 * block above: `Input`, `ListBox`, `Popover` and `Button` are generic in
 * react-aria-components and specific here.
 *
 * Unstyled on purpose, exactly as the menu and tab primitives are: the host supplies class
 * names, so no variant layer accumulates in this package for a component the registry may
 * later ship its own opinion about. Closing the gap upstream is the ADR-22 route if one
 * arrives.
 */
export {
  Button as ComboBoxButton,
  ComboBox,
  Input as ComboBoxInput,
  Label as ComboBoxLabel,
  ListBox as ComboBoxListBox,
  ListBoxItem as ComboBoxOption,
  Popover as ComboBoxPopover,
} from "react-aria-components";
