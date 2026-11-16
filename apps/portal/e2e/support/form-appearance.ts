import { expect } from "@playwright/test";

import type { DerivedLook, FormAppearanceFixtures } from "./api-server.js";
import { API_BASE_URL, FIXED_INTERNAL_TOKEN } from "./harness-config.js";

export interface PublishedAppearance {
  readonly palettes: DerivedLook["palettes"];
  readonly logo: string | null;
  readonly face: string;
  readonly corners: "sharp" | "subtle" | "rounded" | "pill";
  readonly density: "compact" | "comfortable" | "spacious";
  readonly textSize: number;
  readonly progress: "side-rail" | "top-indicator" | "none";
  readonly pageTint: boolean;
}

export function appearanceOf(
  look: DerivedLook,
  overrides: Partial<PublishedAppearance> = {},
): PublishedAppearance {
  return {
    palettes: look.palettes,
    logo: null,
    face: "merriweather",
    corners: "sharp",
    density: "spacious",
    textSize: 16,
    progress: "top-indicator",
    pageTint: look.pageTint,
    ...overrides,
  };
}

/** An admin API call as the seeded editor, straight to the harness API. */
export async function admin(
  fixtures: FormAppearanceFixtures,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${API_BASE_URL}/admin${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-qcms-internal-token": FIXED_INTERNAL_TOKEN,
      "x-qcms-admin-session": fixtures.adminSessionToken,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function ok(response: Response, what: string): Promise<unknown> {
  const text = await response.text();
  expect(response.ok, `${what}: ${String(response.status)} ${text}`).toBe(true);
  return text === "" ? undefined : (JSON.parse(text) as unknown);
}

/**
 * Save the draft with this appearance, publish it, and release it to prod through test,
 * so the next session a respondent starts is pinned to it.
 */
export async function publishAppearance(
  fixtures: FormAppearanceFixtures,
  formId: string,
  appearance: PublishedAppearance,
): Promise<number> {
  const current = (await ok(
    await admin(fixtures, "GET", `/forms/${formId}/versions/1`),
    "read version 1",
  )) as { definition: Record<string, unknown> };
  await ok(
    await admin(fixtures, "PUT", `/forms/${formId}/draft`, {
      // The seeded copy shares the insurance definition, whose own id is another form's.
      definition: { ...current.definition, formId },
      appearance,
    }),
    "save the draft",
  );
  const published = (await ok(
    await admin(fixtures, "POST", `/forms/${formId}/publish-and-release`, {
      environment: "test",
    }),
    "publish to test",
  )) as { version: number };
  await ok(
    await admin(fixtures, "POST", `/forms/${formId}/releases`, {
      environment: "prod",
      version: published.version,
      fromEnvironment: "test",
    }),
    "release to prod",
  );
  return published.version;
}

/** A decodable 1x1 PNG, so a rendered logo proves the bytes reached the browser. */
export const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export interface StoredTheme {
  readonly themeId: string;
  readonly logoKey: string;
  readonly palettes: DerivedLook["palettes"];
  readonly face: string;
  readonly corners: PublishedAppearance["corners"];
  readonly pageTint: boolean;
}

/**
 * A workspace theme carrying a logo, read back as a drawer would apply it. A takedown bars
 * its bytes for good, so a test that takes one down passes bytes no other test uploads.
 */
export async function createThemeWithLogo(
  fixtures: FormAppearanceFixtures,
  name: string,
  look: DerivedLook,
  logoBase64: string = ONE_PIXEL_PNG,
): Promise<StoredTheme> {
  const base = `/workspaces/${fixtures.workspaceId}/themes`;
  const created = (await ok(
    await admin(fixtures, "POST", base, {
      name,
      palettes: look.palettes,
      face: "atkinson",
      corners: "pill",
      pageTint: look.pageTint,
    }),
    "create the theme",
  )) as { theme: { themeId: string } };
  const { themeId } = created.theme;
  await ok(
    await admin(fixtures, "POST", `${base}/${themeId}/logo`, { bytesBase64: logoBase64 }),
    "upload the logo",
  );
  const read = (await ok(await admin(fixtures, "GET", `${base}/${themeId}`), "read the theme")) as {
    theme: Omit<StoredTheme, "themeId">;
  };
  return { themeId, ...read.theme };
}

/** The same decodable image under a different digest: trailing bytes after IEND. */
export function distinctPng(tag: string): string {
  return Buffer.concat([Buffer.from(ONE_PIXEL_PNG, "base64"), Buffer.from(tag)]).toString("base64");
}

/** A Site administrator's takedown, which leaves every version still naming the key. */
export async function takeDownLogo(fixtures: FormAppearanceFixtures, key: string): Promise<void> {
  await ok(await admin(fixtures, "DELETE", `/logos/${key}`), "take the logo down");
}
