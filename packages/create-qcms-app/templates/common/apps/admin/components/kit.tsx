"use client";

/**
 * The admin's client boundary for the shared UI kit (task 031).
 *
 * `@roonga/qcms-ui/kit` re-exports the vendored a2-react-aria components (ADR-22), and
 * every one of them is interactive react-aria: hooks and context, so React Server
 * Components cannot render them directly. This module is the single `"use client"`
 * boundary that makes them available to the admin's server components, which is the
 * standard App Router pattern for a component library.
 *
 * It is a re-export and nothing else. No wrapper, no default props, no QCMS
 * variant: a wrapper layer here would be a second design language accumulating
 * outside `packages/ui`, which is exactly what ADR-22's single-stack rule forbids.
 * Anything the admin genuinely needs on top of a control belongs upstream in
 * a2-react-aria, vendored in through the CLI.
 *
 * These components still render server-side. Next SSRs client components, so the
 * sign-in and 2FA screens produce complete HTML and their `<form method="post">`
 * submits natively - the whole auth loop works before hydration and with JavaScript
 * off.
 */

export {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Checkbox,
  ComboBox,
  ComboBoxButton,
  ComboBoxInput,
  ComboBoxLabel,
  ComboBoxListBox,
  ComboBoxOption,
  ComboBoxPopover,
  DatePicker,
  Dialog,
  Form,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuSeparator,
  MenuTrigger,
  MenuTriggerButton,
  NumberField,
  Select,
  Tab,
  Table,
  TabList,
  TabPanel,
  Tabs,
  Text,
  TextField,
} from "@roonga/qcms-ui/kit";
export type { BreadcrumbItem, SelectItem, TableColumn, TableRow } from "@roonga/qcms-ui/kit";
