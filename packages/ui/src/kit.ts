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
export { NumberField } from "./components/a2ui/number-field/index.ts";
export { Select } from "./components/a2ui/select/index.ts";
export type { SelectItem } from "./components/a2ui/select/index.ts";
export { Table } from "./components/a2ui/table/index.ts";
export type { TableColumn, TableRow } from "./components/a2ui/table/index.ts";
export { Text } from "./components/a2ui/text/index.ts";
export { TextField } from "./components/a2ui/text-field/index.ts";
