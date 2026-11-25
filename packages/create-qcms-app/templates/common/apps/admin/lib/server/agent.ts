/** Only the enabled boolean reaches clients; provider, model and credentials remain server configuration. Disabled deployments mount no assist routes or UI. */
export function agentAuthoringEnabled(): boolean {
  const flag = process.env.QCMS_FLAG_AGENT_AUTHORING;
  return flag !== undefined && flag !== "none" && flag !== "";
}

/**
 * The SEC-18 derive flag, separate from the agent flag (agent-builder Q20). Only `on` enables, as
 * in the API enum that refuses boot on any other spelling, so the two sides cannot disagree about
 * a value either would have accepted.
 */
export function themeDeriveEnabled(): boolean {
  return process.env.QCMS_FLAG_THEME_DERIVE === "on";
}
