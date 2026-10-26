"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/kit";
import { environmentCookie } from "@/lib/environment";
import { t } from "@/lib/i18n/en";

export function SwitchToTest({ secure }: { readonly secure: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      size="md"
      isDisabled={pending}
      onPress={() => {
        document.cookie = environmentCookie("test", secure);
        startTransition(() => router.refresh());
      }}
    >
      {t("forms.workflow.switchToTest")}
    </Button>
  );
}
