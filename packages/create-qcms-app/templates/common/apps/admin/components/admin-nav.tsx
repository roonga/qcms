"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { t } from "@/lib/i18n/en";
import {
  AUTHORING_PATH,
  OPERATIONS_PATH,
  permitsMode,
  WORKSPACES_PATH,
  type ShellCapabilities,
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
    <Link href={href} aria-current={active ? "page" : undefined} className="qcms-nav__link">
      {label}
    </Link>
  );
}

export function AdminNav({
  capabilities,
  operationsGroup,
}: {
  readonly capabilities: ShellCapabilities;
  /** Stands in for the Operations item while in Operations, so the area is named once. */
  readonly operationsGroup?: ReactNode;
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
            <NavLink href={WORKSPACES_PATH} label={t("nav.workspaces")} pathname={pathname} />
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
