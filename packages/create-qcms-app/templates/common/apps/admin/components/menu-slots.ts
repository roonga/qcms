import type { MenuClassNames } from "@/components/kit";

/**
 * The class names every admin menu wears (issue #234).
 *
 * The vendored `Menu` takes a `classNames` object whose entries REPLACE its own
 * defaults, slot by slot, which is what lets a registry component wear this app's
 * shapes without a wrapper layer growing here (ADR-22). The rules themselves live in
 * `app/globals.css` under "THE TOPBAR'S TRAILING GROUP", written at document scope
 * because react-aria portals the popover to the body.
 *
 * The surface is shared and the trigger is not: one menu recipe, four different
 * buttons opening it. A caller spreads this and adds its own `trigger`.
 */
export const MENU_SURFACE: MenuClassNames = {
  popover: "qcms-menu",
  menu: "qcms-menu__list",
  item: "qcms-menu__item",
  header: "qcms-menu__info",
  separator: "qcms-menu__sep",
};

/** The surface above, wearing one caller's trigger class. */
export function menuClasses(trigger: string): MenuClassNames {
  return { ...MENU_SURFACE, trigger };
}
