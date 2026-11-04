import type { MenuClassNames } from "@/components/kit";

/* Menu slot classes replace kit defaults; popover rules must live at document scope because the menu
   portals to body. */
export const MENU_SURFACE: MenuClassNames = {
  popover: "qcms-menu",
  menu: "qcms-menu__list",
  item: "qcms-menu__item",
  header: "qcms-menu__info",
  separator: "qcms-menu__sep",
};

export function menuClasses(trigger: string): MenuClassNames {
  return { ...MENU_SURFACE, trigger };
}
