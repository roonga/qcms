import { t } from "@/lib/i18n/en";

export function AgentProvenanceTag() {
  return (
    <span className="qcms-tag qcms-tag--agent-assisted" data-testid="qcms-agent-provenance">
      {t("forms.assist.provenance")}
    </span>
  );
}
