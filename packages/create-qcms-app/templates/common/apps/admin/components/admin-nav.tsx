"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { t } from "@/lib/i18n/en";
import { workspaceAreaLabel } from "@/lib/membership/sections";
import {
  AUTHORING_PATH,
  declaredMode,
  OPERATIONS_PATH,
  permitsMode,
  SITE_CONFIGURATION_LANDING,
  SITE_CONFIGURATION_PATH,
  WORKSPACES_PATH,
  type ShellCapabilities,
  type ShellMode,
} from "@/lib/shell/modes";

/* Omit inaccessible areas rather than naming them in disabled navigation. */
const ITEMS = [
  { href: AUTHORING_PATH, label: t("nav.questions"), area: "authoring" },
  { href: "/forms", label: t("nav.forms"), area: "authoring" },
] as const;

const SEPARATED = {
  href: OPERATIONS_PATH,
  label: t("nav.operations"),
  area: "operations",
} as const;

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** An area's item is current wherever the shell places the address in that area, New workspace included. */
function inArea(pathname: string, mode: ShellMode): boolean {
  return declaredMode(pathname) === mode;
}

function NavLink({
  href,
  label,
  pathname,
  area = href,
  mode,
}: {
  readonly href: string;
  readonly label: string;
  readonly pathname: string;
  /** The address prefix the item stands for, where it lands somewhere beneath it. */
  readonly area?: string;
  /** The shell area the item stands for, which outranks the address prefix. */
  readonly mode?: ShellMode;
}) {
  const active = mode === undefined ? isActive(pathname, area) : inArea(pathname, mode);
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className="qcms-nav__link">
      {label}
    </Link>
  );
}

export function AdminNav({
  capabilities,
  operationsGroup,
  multipleWorkspaces = true,
}: {
  readonly capabilities: ShellCapabilities;
  /** Stands in for the Operations item while in Operations, so the area is named once. */
  readonly operationsGroup?: ReactNode;
  readonly multipleWorkspaces?: boolean;
}) {
  const pathname = usePathname();
  const items = ITEMS.filter((item) => capabilities[item.area]);

  return (
    <nav aria-label={t("nav.label")}>
      <ul className="flex items-center gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <NavLink href={item.href} label={item.label} pathname={pathname} />
          </li>
        ))}
        {capabilities.workspaces && (
          <li>
            <NavLink
              href={WORKSPACES_PATH}
              label={t(workspaceAreaLabel(multipleWorkspaces))}
              pathname={pathname}
              mode="workspaces"
            />
          </li>
        )}
        {capabilities.siteConfiguration && (
          <li>
            <NavLink
              href={SITE_CONFIGURATION_LANDING}
              area={SITE_CONFIGURATION_PATH}
              label={t("site.title")}
              pathname={pathname}
              mode="site"
            />
          </li>
        )}
        {permitsMode(capabilities, SEPARATED.area) && (
          <li className="qcms-nav__separated">
            {operationsGroup ?? (
              <NavLink href={SEPARATED.href} label={SEPARATED.label} pathname={pathname} />
            )}
          </li>
        )}
      </ul>
    </nav>
  );
}
