import type { MintedLink, SecureLink } from "../forms/types.ts";

import { proposalHeaders, type AgentProposalRef } from "./agent-proposal.ts";
import { adminApiFetch } from "./api.ts";
import type { ApiResult } from "./api-result.ts";
import { readResult } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

/** Mint results are the only source of bearer URLs; the API never stores tokens for re-reading. Never log, persist or include them in error messages. */

export const MAX_LINK_BATCH = 100;

export async function mintLinks(
  session: AdminSession,
  formId: string,
  request: {
    /** Environment is required without a default: minting must never silently produce production links under a test banner. */
    readonly environment: string;
    readonly expiresAt: string;
    readonly oneTime: boolean;
    readonly count: number;
  },

  proposal?: AgentProposalRef,
): Promise<ApiResult<readonly MintedLink[]>> {
  const result = await readResult<{ links?: unknown }>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/links`, {
      method: "POST",
      body: request,
      headers: proposalHeaders(proposal),
    }),
  );
  if (!result.ok) return result;
  return { ok: true, data: parseMinted(result.data.links) };
}

export async function listLinks(
  session: AdminSession,
  formId: string,
): Promise<ApiResult<readonly SecureLink[]>> {
  const result = await readResult<{ links?: unknown }>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/links`),
  );
  if (!result.ok) return result;
  return { ok: true, data: parseLinks(result.data.links) };
}

/** The form segment scopes API revocation; a link from another form must not be revocable here. */
export async function revokeLink(
  session: AdminSession,
  formId: string,
  linkId: string,
  proposal?: AgentProposalRef,
): Promise<ApiResult<{ readonly linkId: string; readonly revokedAt: string }>> {
  const path: `/${string}` = `/forms/${encodeURIComponent(formId)}/links/${encodeURIComponent(linkId)}/revoke`;
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(session, path, { method: "POST", headers: proposalHeaders(proposal) }),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      linkId: text(result.data["linkId"], linkId),
      revokedAt: text(result.data["revokedAt"], ""),
    },
  };
}

const LINK_STATES: readonly SecureLink["state"][] = ["active", "consumed", "expired", "revoked"];

function text(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw !== "" ? raw : fallback;
}

function nullableText(raw: unknown): string | null {
  return typeof raw === "string" && raw !== "" ? raw : null;
}

function rows(raw: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
  );
}

function parseMinted(raw: unknown): readonly MintedLink[] {
  return rows(raw)
    .filter((entry) => typeof entry["url"] === "string")
    .map((entry) => ({
      linkId: text(entry["linkId"], ""),

      environment: text(entry["environment"], ""),
      url: entry["url"] as string,
      expiresAt: text(entry["expiresAt"], ""),
    }));
}

/** Unknown link states remain visible and revocable: an unclassified bearer link may still be live. */
function parseLinks(raw: unknown): readonly SecureLink[] {
  return rows(raw)
    .filter((entry) => typeof entry["linkId"] === "string")
    .map((entry) => ({
      linkId: entry["linkId"] as string,
      environment: text(entry["environment"], ""),
      state: LINK_STATES.find((state) => state === entry["state"]) ?? "active",
      oneTime: entry["oneTime"] === true,
      expiresAt: text(entry["expiresAt"], ""),
      consumedAt: nullableText(entry["consumedAt"]),
      revokedAt: nullableText(entry["revokedAt"]),
      createdAt: text(entry["createdAt"], ""),
    }));
}
