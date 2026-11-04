/** Only the enabled boolean reaches clients; provider, model and credentials remain server configuration. Disabled deployments mount no assist routes or UI. */
export function agentAuthoringEnabled(): boolean {
  const flag = process.env.QCMS_FLAG_AGENT_AUTHORING;
  return flag !== undefined && flag !== "none" && flag !== "";
}
