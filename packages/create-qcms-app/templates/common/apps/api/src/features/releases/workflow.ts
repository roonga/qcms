import { listFormReleases } from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";
import type { FormId } from "@roonga/qcms-core";

import { ApiError } from "../../errors.js";

/** The deployment's test/prod workflow, independent of a caller's visible environments. */
export function usesTestWorkflow(environments: readonly string[]): boolean {
  return environments.includes("test") && environments.includes("prod");
}

/** Append-only evidence survives later test releases and legacy production rollbacks. */
export function productionVersions(
  releases: readonly { environment: string; version: number }[],
): readonly number[] {
  return [
    ...new Set(
      releases
        .filter((release) => release.environment === "test" || release.environment === "prod")
        .map((release) => release.version),
    ),
  ];
}

export function testReleaseRequired(): ApiError {
  return new ApiError(
    "TEST_RELEASE_REQUIRED",
    409,
    "Publish and verify this version in test, then select prod and release the existing version.",
  );
}

export async function requireProductionCandidate(
  exec: Executor,
  environments: readonly string[],
  environment: string,
  formId: FormId,
  version: number,
): Promise<void> {
  if (!usesTestWorkflow(environments) || environment !== "prod") return;
  if (!productionVersions(await listFormReleases(exec, formId)).includes(version)) {
    throw testReleaseRequired();
  }
}
