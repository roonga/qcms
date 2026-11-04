/**
 * Re-export primitives without schemas so admin chrome cannot become an A2UI document surface.
 * Consumers must load theme.css and import from a client module.
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

/** The pinned registry provides no Tabs; use the stack primitives rather than hand-rolling keyboard behavior. */
export { Tab, TabList, TabPanel, Tabs } from "react-aria-components";
/**
 * Lets a consuming app name its locale instead of inheriting the browser's, which
 * differs between the server render and the hydrated one.
 */
export { I18nProvider } from "react-aria-components";

/** The pinned registry lacks standalone switch and radio primitives; use its React Aria foundation. */
export {
  RadioButton,
  RadioField,
  RadioGroup,
  SwitchButton,
  SwitchField,
} from "react-aria-components";

/** Aliases avoid collisions with vendored names; the stack owns combobox focus and listbox relationships. */
export {
  Button as ComboBoxButton,
  ComboBox,
  Input as ComboBoxInput,
  Label as ComboBoxLabel,
  ListBox as ComboBoxListBox,
  ListBoxItem as ComboBoxOption,
  Popover as ComboBoxPopover,
} from "react-aria-components";
