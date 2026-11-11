"use client";

import { useRef } from "react";

import { Menu } from "@/components/kit";
import { menuClasses } from "@/components/menu-slots";
import { clearStoredConversation } from "@/lib/agent/conversation";
import { t } from "@/lib/i18n/en";
import { initialsFor } from "@/lib/initials";
import { MY_ACCESS_PATH, SETTINGS_PATH } from "@/lib/shell/modes";

/* Keep sign-out as a POST form: GET would let prefetch or crawlers end a session. */

export function AccountMenu({ email, name }: { readonly email: string; readonly name?: string }) {
  const signOutForm = useRef<HTMLFormElement>(null);
  const initials = initialsFor(email, name);

  return (
    <div className="qcms-account" data-testid="account-menu">
      <Menu
        triggerLabel={t("account.trigger", { initials, email })}
        trigger={<span aria-hidden="true">{initials}</span>}
        menuLabel={t("account.menuLabel")}
        /* The account header labels the menu but must stay outside its keyboard item sequence. */
        header={
          <>
            <span className="qcms-menu__who">{t("account.signedInAs")}</span>
            <span className="qcms-menu__email">{email}</span>
          </>
        }
        classNames={menuClasses("qcms-avatar qcms-round")}
        onAction={(key) => {
          if (key !== "sign-out") return;
          // The POST does not clear tab storage, so the assistant conversation goes here.
          clearStoredConversation();
          signOutForm.current?.requestSubmit();
        }}
        items={[
          { id: "settings", label: t("nav.settings"), href: SETTINGS_PATH },
          { id: "access", label: t("access.title"), href: MY_ACCESS_PATH },
          {
            id: "password",
            label: t("action.changePassword"),
            href: "/settings#change-password",
          },
          { id: "sign-out", label: t("action.signOut") },
        ]}
      />
      <form ref={signOutForm} method="post" action="/sign-out" hidden />
    </div>
  );
}
