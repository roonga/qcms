/**
 * ADR-22 puts one component stack across both frontends, so the admin's controls are re-exported here.
 * No wrappers: every export is the vendored component itself. No schemas: `*Schema` or `*Node` would invite an
 * A2UI document into an admin screen; `registryForSpecVersion` stays the only door to the renderer.
 * A host must load `@roonga/qcms-ui/theme.css` and import this from a "use client" module.
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
 * The pinned registry has no `Tabs` to vendor and ADR-22's lint fence allows
 * react-aria-components as the alternative, so the APG keyboard contract comes from
 * the stack's own foundation rather than being hand-rolled per screen. Unstyled, so no
 * variant layer accumulates here for a component the registry may later opine on.
 */
export { Tab, TabList, TabPanel, Tabs } from "react-aria-components";
/**
 * Lets a consuming app name its locale instead of inheriting the browser's, which
 * differs between the server render and the hydrated one.
 */
export { I18nProvider } from "react-aria-components";

/**
 * The popup, switch and radio-group primitives an app's own chrome needs. The pinned registry's `Dialog` is a modal
 * carrying its own trigger and title, and it ships no non-modal popover, no switch, and no radio group outside the
 * A2UI schema, so ADR-22's react-aria-components alternative applies. Aliased where a bare name would collide with
 * a vendored component.
 */
export {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger,
  Popover as AriaPopover,
  Radio,
  RadioGroup,
  Switch,
} from "react-aria-components";

/**
 * Aliased because the bare names collide with the vendored components. The pinned registry ships no combobox,
 * and a hand-rolled filter over a `Select` would get the APG combobox pattern's `aria-activedescendant` and
 * input-to-listbox relationship wrong.
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
