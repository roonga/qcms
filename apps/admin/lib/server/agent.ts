/**
 * Agent-authoring flag (task 041, ADR-24, ADR-25).
 *
 * The panel and its routes exist only when this deployment names a provider. `none`
 * (unset, or the literal string `"none"`) is the default and means: no assist routes
 * mounted, no chat UI rendered - not hidden, absent. Same shape as the portal's
 * `challengeProvider()` (`apps/portal/lib/server/challenge.ts`): the flag is a
 * server-only read, and only its *effect* (a boolean) is ever handed to anything a
 * client component touches. The flag's actual value (which provider, which model) is
 * config for the API's own boot (`QCMS_AGENT_MODEL`, `QCMS_AGENT_API_KEY`) and never
 * needs to reach this app at all.
 */
export function agentAuthoringEnabled(): boolean {
  const flag = process.env.QCMS_FLAG_AGENT_AUTHORING;
  return flag !== undefined && flag !== "none" && flag !== "";
}
