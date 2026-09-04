---
"@roonga/qcms-ui": minor
---

Export the react-aria `Tabs`, `TabList`, `Tab` and `TabPanel` primitives from `@roonga/qcms-ui/kit`.

The pinned a2-react-aria registry has no tabs component to vendor, and ADR-22 names the
alternative explicitly: a host uses the vendored components or react-aria-components. These
are re-exported unstyled, exactly as the menu primitives already are, so a host that needs
the APG tabs pattern gets its keyboard contract and its roles from the stack's own
foundation instead of hand-rolling them per screen. Nothing else in the package changes.
