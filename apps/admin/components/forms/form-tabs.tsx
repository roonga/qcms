"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { t } from "@/lib/i18n/en";

/**
 * The sections of one form: builder, preview, history, links, responses, webhooks
 * (task 034; the last two added by 035).
 *
 * ## The builder is the only screen that still renders this (issue 561)
 *
 * `plan/admin-design-contracts.md` §7 gives the rail the same six routes, so a screen with
 * a rail does not also carry this strip - it would offer one operator two navigations to
 * the same six places and give a screen reader two `nav` landmarks saying the same thing.
 * Seven of the eight form-scoped screens now have the rail and dropped the strip with it
 * (`components/forms/form-page-header.tsx`). The builder is the exception, and the reason
 * is recorded with the exception itself in `lib/rail-routes.test.ts`: it already carries a
 * step list that is an EDITOR, and reconciling that with §7's read-only step group is a
 * layout question nobody has ruled on. So this component stays until that ruling lands,
 * and it stays reachable from exactly one page.
 *
 * A `nav` of ordinary links rather than a tab widget, and the difference matters. These
 * are four routes, not four panels: each is separately addressable, separately
 * bookmarkable, and reloads on its own. Rendering them as ARIA tabs would promise
 * same-page panel switching that does not happen and would take the links' native
 * behaviours away (middle-click, open in a new tab) in exchange for nothing.
 *
 * The current section carries `aria-current="page"`, which is what a screen reader
 * announces; the underline is the visual echo of it, never the only signal.
 */
export function FormTabs({ formId }: { readonly formId: string }) {
  const pathname = usePathname();
  const base = `/forms/${encodeURIComponent(formId)}`;
  const sections = [
    { href: base, label: t("forms.tab.builder") },
    { href: `${base}/preview`, label: t("forms.tab.preview") },
    { href: `${base}/versions`, label: t("forms.tab.versions") },
    { href: `${base}/links`, label: t("forms.tab.links") },
    { href: `${base}/responses`, label: t("forms.tab.responses") },
    { href: `${base}/webhooks`, label: t("forms.tab.webhooks") },
  ];

  return (
    <nav aria-label={t("forms.tab.label")} data-testid="qcms-form-tabs">
      <ul className="flex flex-wrap gap-1 border-b border-(--color-border)">
        {sections.map((section) => {
          const current = isCurrent(pathname, section.href, base);
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                className="qcms-form-tab"
                {...(current ? { "aria-current": "page" as const } : {})}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Whether `href` is the section the current path is in.
 *
 * The builder is the base path and matches only exactly, because every other section is a
 * path *under* it; the others match their own subtree, so `/versions/3` still marks
 * History as current.
 */
function isCurrent(pathname: string, href: string, base: string): boolean {
  if (href === base) return pathname === base;
  return pathname === href || pathname.startsWith(`${href}/`);
}
