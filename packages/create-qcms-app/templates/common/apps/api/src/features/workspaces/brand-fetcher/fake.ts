import { refuse } from "./port.js";
import type { BeforeContact, BrandFetcher, BrandResourceKind, FetchedResource } from "./port.js";
import { checkContent } from "./policy.js";

/** For a composition with no network: every fetch is the uniform refusal. */
export const refusingBrandFetcher: BrandFetcher = {
  fetch: () => Promise.reject(refuse("no-network")),
};

export interface FakeResource {
  readonly contentType: string;
  readonly body: Uint8Array | string;
}

/**
 * Serves canned resources by exact URL and refuses anything else, holding each to the same
 * content-type and sniff check the real fetcher applies, and following one canned redirect
 * as the real fetcher would. Records every fetch it was asked for.
 */
export class FakeBrandFetcher implements BrandFetcher {
  readonly requests: { readonly url: string; readonly kind: BrandResourceKind }[] = [];
  private readonly resources = new Map<string, FakeResource>();
  private readonly redirects = new Map<string, string>();

  serve(url: string, resource: FakeResource): this {
    this.resources.set(new URL(url).href, resource);
    return this;
  }

  redirect(from: string, to: string): this {
    this.redirects.set(new URL(from).href, new URL(to).href);
    return this;
  }

  async fetch(
    raw: string | URL,
    kind: BrandResourceKind,
    beforeContact?: BeforeContact,
  ): Promise<FetchedResource> {
    let url = new URL(raw);
    this.requests.push({ url: url.href, kind });
    await beforeContact?.(url.hostname);
    const target = this.redirects.get(url.href);
    if (target !== undefined) {
      url = new URL(target);
      await beforeContact?.(url.hostname);
    }
    const resource = this.resources.get(url.href);
    if (resource === undefined) throw refuse("fake-unknown-url");
    const body =
      typeof resource.body === "string" ? new TextEncoder().encode(resource.body) : resource.body;
    return { url, contentType: checkContent(kind, resource.contentType, body), body };
  }
}
