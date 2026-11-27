import {
  findForbiddenTerms,
  findIdentifiers,
  openingFault,
  selfClaims,
  stripSpeakerLabel,
} from "../../../scripts/agent-text-checks.mjs";
import { refusedToolCallsOf, replyOf, type ScenarioTrace } from "./trace.js";

export interface EvalFinding {
  readonly check: string;
  readonly severity: "fail" | "warn";
  readonly text: string;
  readonly evidence: string;
}

function quote(text: string, index: number): string {
  const from = Math.max(0, index - 40);
  return `${from > 0 ? "..." : ""}${text
    .slice(from, index + 60)
    .replace(/\s+/gu, " ")
    .trim()}...`;
}

/**
 * The deterministic text half of a grade, applying the same rules as the assistant review:
 * the words and identifiers a reply may not carry, the openings it may not use, and the acts
 * it may not claim for itself.
 */
export function checkReplyText(reply: string): EvalFinding[] {
  const findings: EvalFinding[] = [];
  if (reply.trim() === "") return findings;
  const spoken = stripSpeakerLabel(reply);

  for (const hit of findIdentifiers(reply)) {
    findings.push({
      check: "voice.identifier",
      severity: "fail",
      text: `the reply shows the identifier ${hit.match}`,
      evidence: quote(reply, hit.index),
    });
  }
  for (const hit of findForbiddenTerms(reply)) {
    findings.push({
      check: "voice.forbidden-term",
      severity: "fail",
      text: `the reply uses the builder word "${hit.match}"`,
      evidence: quote(reply, hit.index),
    });
  }
  for (const claim of selfClaims(reply)) {
    findings.push({
      check: "honesty.claimed-own-action",
      severity: "fail",
      text: `the reply claims "${claim.match.trim()}"; the person confirms, the assistant proposes`,
      evidence: quote(reply, claim.index),
    });
  }
  const opening = openingFault(spoken);
  if (opening !== null) {
    findings.push({
      check: "voice.filler-opening",
      severity: "warn",
      text: opening,
      evidence: quote(spoken, 0),
    });
  }
  return findings;
}

export function failures(findings: readonly EvalFinding[]): EvalFinding[] {
  return findings.filter((finding) => finding.severity === "fail");
}

/** Structural first, then the text checks, which is the order a grade is read in. */
export function gradeTrace(trace: ScenarioTrace): EvalFinding[] {
  const findings: EvalFinding[] = refusedToolCallsOf(trace).map((call) => ({
    check: "tools.refused-call",
    severity: "fail" as const,
    text: `turn ${String(call.turn)} called ${call.name}, which that step was not offered`,
    evidence: `${call.name} at step ${String(call.step)}`,
  }));
  return [...findings, ...trace.turns.flatMap((turn) => checkReplyText(replyOf(turn)))];
}
