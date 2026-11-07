"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { t } from "@/lib/i18n/en";
import { breadcrumbTrail, type CrumbNames } from "@/lib/shell/breadcrumbs";

/** The content column's first row on every screen, so the heading below it never moves. */
export function ShellBreadcrumb({ names }: { readonly names?: CrumbNames }) {
  // Null outside the App Router, which is where the rail's own render tests mount it.
  const pathname = usePathname() as string | null;
  const trail = breadcrumbTrail(pathname ?? "", names);
  const last = trail.length - 1;
  if (trail.length === 0) return <div className="qcms-crumbs" aria-hidden="true" />;
  return (
    <nav aria-label={t("breadcrumb.label")} className="qcms-crumbs" data-testid="qcms-breadcrumb">
      <ol className="qcms-crumbs__list">
        {trail.map((crumb, index) => {
          const face = crumb.code === true ? " qcms-crumbs__code" : "";
          const current = index === last ? { "aria-current": "page" as const } : {};
          return (
            <li key={`${String(index)}:${crumb.label}`} className="qcms-crumbs__item">
              {crumb.href === undefined ? (
                <span className={`qcms-crumbs__text${face}`} {...current}>
                  {crumb.label}
                </span>
              ) : (
                <Link href={crumb.href} className={`qcms-crumbs__link${face}`}>
                  {crumb.label}
                </Link>
              )}
              {index !== last && (
                <span className="qcms-crumbs__separator" aria-hidden="true">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
