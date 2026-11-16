export type BrandResourceKind = "page" | "stylesheet" | "logo";

export interface FetchedResource {
  /** The URL the body came from, after any redirect. */
  readonly url: URL;
  /** The allowlisted media type, already confirmed by sniff. */
  readonly contentType: string;
  readonly body: Uint8Array;
}

/**
 * Called with each host once it passes F1 and before anything is sent to it, the redirect
 * target included, so the audit names every host contacted (W4). What it throws is
 * rethrown as it is, never folded into the uniform refusal.
 */
export type BeforeContact = (host: string) => Promise<void>;

/** The only outbound fetch to an address a user chose (SEC-18). Every refusal is a {@link BrandFetchRefused}. */
export interface BrandFetcher {
  fetch(
    url: string | URL,
    kind: BrandResourceKind,
    beforeContact?: BeforeContact,
  ): Promise<FetchedResource>;
}

/**
 * `reason` is for tests and the operator log alone. The route answers every refusal with
 * one body whatever the reason (F10), so it is never an address or port oracle.
 */
export class BrandFetchRefused extends Error {
  constructor(readonly reason: string) {
    super("brand fetch refused");
    this.name = "BrandFetchRefused";
  }
}

export function refuse(reason: string): BrandFetchRefused {
  return new BrandFetchRefused(reason);
}

export interface ReencodedLogo {
  readonly contentType: "image/png";
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

/** Decodes a raster logo, holds it to the pixel cap and re-encodes it, for a derive and a hand upload alike (F7). */
export interface LogoCodec {
  reencode(bytes: Uint8Array): Promise<ReencodedLogo>;
}

export type LogoRefusalReason = "not-raster" | "unsupported" | "too-many-pixels" | "too-large";

export class LogoRefused extends Error {
  constructor(readonly reason: LogoRefusalReason) {
    super(`logo refused: ${reason}`);
    this.name = "LogoRefused";
  }
}
