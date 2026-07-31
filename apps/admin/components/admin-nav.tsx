"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { t } from "@/lib/i18n/en";

/**
 * The shell's primary navigation (task 031; wireframe region "shell top bar").
 *
 * A client component for exactly one reason: the active item. The wireframe makes
 * "active state visible" and `aria-current` normative, and a layout cannot know which
 * child route rendered, so the pathname has to be read where it is available.
 * `usePathname` works during server rendering of a client component too, so the
 * active state is correct in the first HTML rather than appearing on hydration.
 *
 * Active matching is prefix-based, not exact, because tasks 032-035 add nested routes
 * (`/forms/{id}/builder`) that must keep "Forms" lit. The prefix is anchored with a
 * trailing-slash test so `/formsomething` could never light it.
 *
 * `aria-current="page"` is the accessible half of the same signal, and the underline
 * is the visual half: colour alone would fail WCAG 1.4.1.
 */
const ITEMS = [
  { href: "/questions", label: t("nav.questions") },
  { href: "/forms", label: t("nav.forms") },
  { href: "/responses", label: t("nav.responses") },
  { href: "/webhooks", label: t("nav.webhooks") },
  { href: "/settings", label: t("nav.settings") },
] as const;

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label={t("nav.label")}>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "text-sm font-semibold text-(--color-primary) underline underline-offset-4"
                    : "text-sm text-(--color-text-muted) hover:text-(--color-text)"
                }
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
