/**
 * `@roonga/qcms-ui/kit` - the shared admin UI kit.
 *
 * Admin screens are ordinary React (ARCHITECTURE §6), but ADR-22 allows one component
 * stack across both frontends and the vendored a2-react-aria sources live in this
 * package alone, so the admin's controls come from here: the same vendored files the
 * A2UI renderer uses, exported on their own subpath as plain React components.
 *
 * Two restraints hold:
 *
 * - No wrappers. Every export is the vendored component itself, so an admin screen and
 *   a rendered A2UI step get the same implementation and the same token-driven styling.
 *   A QCMS-flavoured wrapper layer would be a second design language by accretion.
 * - No schemas. `*Schema` exports and `*Node` types belong to the A2UI document format,
 *   and re-exporting them here would invite an admin screen to grow a document.
 *   `registryForSpecVersion` stays the only door to the renderer.
 *
 * Styling is Tailwind utilities over the four ADR-30 token groups, so a host must load
 * `@roonga/qcms-ui/theme.css`, or its own file defining the same custom properties.
 *
 * Everything here is interactive react-aria, so a Next.js consumer imports it from a
 * `"use client"` module.
 *
 * Where a vendored component falls short, ADR-22's route is to fix it upstream and never
 * fork it here. `classNames` is what keeps a variant layer from growing in this package:
 * a host names the classes for each slot and its names replace the component's defaults.
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
export type {
  MenuActionEntry,
  MenuClassNames,
  MenuItemEntry,
  MenuSeparatorEntry,
} from "./components/a2ui/menu/index.ts";
export { NumberField } from "./components/a2ui/number-field/index.ts";
export { Select } from "./components/a2ui/select/index.ts";
export type { SelectItem } from "./components/a2ui/select/index.ts";
export { Table } from "./components/a2ui/table/index.ts";
export type { TableColumn, TableRow } from "./components/a2ui/table/index.ts";
export { Text } from "./components/a2ui/text/index.ts";
export { TextField } from "./components/a2ui/text-field/index.ts";

/**
 * The tab primitives. The pinned registry has no `Tabs` to vendor and ADR-22's lint
 * fence allows react-aria-components as the alternative, so a host needing the APG tabs
 * pattern (roving tabindex, arrow-key movement, `aria-controls` to the panel, and the
 * "tab 2 of 3, selected" announcement) composes it from the stack's own foundation
 * rather than hand-rolling that keyboard contract per screen.
 *
 * Unstyled on purpose: the host supplies class names, so no variant layer accumulates
 * here for a component the registry may later ship its own opinion about.
 */
export { Tab, TabList, TabPanel, Tabs } from "react-aria-components";
/**
 * react-aria's locale boundary, so a consuming app can name the locale its kit controls
 * format and order dates in instead of inheriting the browser's, which differs between
 * the server render and the hydrated one.
 */
export { I18nProvider } from "react-aria-components";

/**
 * The combobox primitives: a text input that filters a list, by the same route as the
 * tab primitives above. The pinned registry ships a `select` and no combobox, and a
 * picker over a list too long to scan is the APG combobox pattern, which carries a
 * roving `aria-activedescendant`, the "N results available" announcement and the
 * input-to-listbox relationship a hand-rolled filter over a `Select` would get wrong.
 *
 * Aliased because the bare names collide with the vendored components. Unstyled on
 * purpose, like the tab primitives.
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
