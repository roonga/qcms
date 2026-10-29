"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { t } from "@/lib/i18n/en";
import {
  AUTHORING_PATH,
  OPERATIONS_PATH,
  WORKSPACES_PATH,
  type ShellCapabilities,
} from "@/lib/shell/modes";

/**
 * The shell's application navigation.
 *
 * A client component for one reason: the active item. A layout cannot know which child
 * route rendered, and `usePathname` resolves during server rendering too, so the active
 * state is right in the first HTML rather than appearing on hydration.
 *
 * Which items exist is the capability projection's answer rather than a string match here.
 * An entry whose area the caller does not hold is absent rather than disabled, so the
 * navigation never names an area it would then refuse. Settings and My access are not here
 * at all: they belong to the signed-in account and live under the avatar.
 *
 * Active matching is prefix-based, because a form's sections must keep Forms lit, and it is
 * anchored with a trailing-slash test so `/formsomething` could never light it.
 */
const ITEMS = [
  { href: AUTHORING_PATH, label: t("nav.questions"), area: "authoring" },
  { href: "/forms", label: t("nav.forms"), area: "authoring" },
  // The two global operational screens, until the forms table that replaces the picker
  // moves them into the Operations mode.
  { href: "/responses", label: t("nav.responses"), area: undefined },
  { href: "/webhooks", label: t("nav.webhooks"), area: undefined },
] as const;

/** Entering it replaces the menus above rather than joining them, so it is drawn apart. */
const SEPARATED = {
  href: OPERATIONS_PATH,
  label: t("nav.operations"),
  area: "operations",
} as const;

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  href,
  label,
  pathname,
}: {
  readonly href: string;
  readonly label: string;
  readonly pathname: string;
}) {
  const active = isActive(pathname, href);
  return (
    // One class in both states: the active treatment is selected by `aria-current` in
    // `globals.css`, so the accessible signal and the visual one cannot drift apart.
    <Link href={href} aria-current={active ? "page" : undefined} className="qcms-nav__link">
      {label}
    </Link>
  );
}

export function AdminNav({ capabilities }: { readonly capabilities: ShellCapabilities }) {
  const pathname = usePathname();
  const items = ITEMS.filter((item) => item.area === undefined || capabilities[item.area]);

  return (
    <nav aria-label={t("nav.label")}>
      <ul className="flex flex-wrap items-center gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <NavLink href={item.href} label={item.label} pathname={pathname} />
          </li>
        ))}
        {capabilities.workspaces && (
          <li>
            <NavLink href={WORKSPACES_PATH} label={t("nav.workspaces")} pathname={pathname} />
          </li>
        )}
        {capabilities[SEPARATED.area] && (
          <li className="qcms-nav__separated">
            <NavLink href={SEPARATED.href} label={SEPARATED.label} pathname={pathname} />
          </li>
        )}
      </ul>
    </nav>
  );
}
