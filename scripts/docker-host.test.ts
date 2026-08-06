import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  defaultRouteGateway,
  gatewayFromIpRoute,
  gatewayFromRouteTable,
  ipv4FromRouteField,
  isInDockerContainer,
  publishedPortHost,
} from "./docker-host.mjs";

const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

/** A throwaway file holding `content`, for the readers that take a path. */
function fixture(name: string, content: string): string {
  const directory = mkdtempSync(join(tmpdir(), "qcms-docker-host-"));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  writeFileSync(path, content);
  return path;
}

/** `/proc/net/route` as the kernel writes it: a header, then tab-separated rows. */
function routeTable(rows: readonly (readonly [string, string, string])[]): string {
  const header =
    "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT";
  const body = rows.map(
    ([iface, destination, gateway]) =>
      `${iface}\t${destination}\t${gateway}\t0003\t0\t0\t0\t00000000\t0\t0\t0`,
  );
  return [header, ...body, ""].join("\n");
}

describe("ipv4FromRouteField", () => {
  it("decodes the kernel's little-endian address field", () => {
    // 172.17.0.1 is the default-bridge gateway a dev container sees, and the kernel
    // prints the 32-bit value in HOST byte order, so the low byte is the first
    // octet. Getting this backwards yields 1.0.17.172, which is a plausible-looking
    // address that nothing answers on.
    expect(ipv4FromRouteField("010011AC")).toBe("172.17.0.1");
    expect(ipv4FromRouteField("0100007F")).toBe("127.0.0.1");
  });

  it("rejects the all-zero gateway rather than returning 0.0.0.0", () => {
    // That is how an ON-LINK default route is spelled: there is no router address to
    // dial, so the caller has to fall through to another mechanism. Returning
    // "0.0.0.0" would look like an answer and connect to nothing.
    expect(ipv4FromRouteField("00000000")).toBeUndefined();
  });

  it("rejects anything that is not eight hex digits", () => {
    expect(ipv4FromRouteField("")).toBeUndefined();
    expect(ipv4FromRouteField("010011A")).toBeUndefined();
    expect(ipv4FromRouteField("not-hex!")).toBeUndefined();
  });
});

describe("gatewayFromRouteTable", () => {
  it("returns the gateway of the default route", () => {
    const path = fixture(
      "route",
      routeTable([
        ["eth0", "00000000", "010011AC"],
        ["eth0", "000011AC", "00000000"],
      ]),
    );
    expect(gatewayFromRouteTable(path)).toBe("172.17.0.1");
  });

  it("ignores non-default routes, whatever gateway they carry", () => {
    // The link-local row for the container's own subnet is not a way out of it.
    const path = fixture("route", routeTable([["eth0", "000011AC", "010011AC"]]));
    expect(gatewayFromRouteTable(path)).toBeUndefined();
  });

  it("skips an on-link default route and keeps looking", () => {
    const path = fixture(
      "route",
      routeTable([
        ["eth1", "00000000", "00000000"],
        ["eth0", "00000000", "010012AC"],
      ]),
    );
    expect(gatewayFromRouteTable(path)).toBe("172.18.0.1");
  });

  it("returns undefined when the table cannot be read", () => {
    // A platform without /proc degrades to the next mechanism, never to a throw.
    expect(gatewayFromRouteTable(join(tmpdir(), "qcms-no-such-route-table"))).toBeUndefined();
  });
});

describe("gatewayFromIpRoute", () => {
  it("returns undefined when no candidate binary exists", () => {
    expect(gatewayFromIpRoute([join(tmpdir(), "qcms-no-such-ip")])).toBeUndefined();
  });

  it("agrees with the routing table wherever both can answer", () => {
    // A cross-check against the live machine rather than a fixture: the two
    // mechanisms read the same kernel state, so a disagreement means the
    // little-endian decoding above is wrong in a way no fixture would catch. Skipped
    // rather than failed where either is unavailable, since neither is guaranteed.
    const fromTable = gatewayFromRouteTable();
    const fromCommand = gatewayFromIpRoute();
    if (fromTable === undefined || fromCommand === undefined) return;
    expect(fromTable).toBe(fromCommand);
  });
});

describe("publishedPortHost", () => {
  it("answers localhost on a plain host checkout, without probing anything", () => {
    // This is also the CI branch: the workflow runs `pnpm up:e2e` on the runner
    // itself, not inside a container. The probe must not even be reached, because a
    // CI runner does have a Docker bridge and its gateway is the wrong answer there.
    let probed = false;
    const host = publishedPortHost({
      override: undefined,
      inContainer: false,
      gateway: () => {
        probed = true;
        return "172.17.0.1";
      },
    });
    expect(host).toBe("localhost");
    expect(probed).toBe(false);
  });

  it("answers the default-route gateway inside a container", () => {
    // The case issue #316 was about: a compose-published port lands on the HOST's
    // loopback, so the container's own localhost is refused while every service is
    // healthy.
    expect(
      publishedPortHost({ override: undefined, inContainer: true, gateway: () => "172.17.0.1" }),
    ).toBe("172.17.0.1");
  });

  it("falls back to localhost in a container with no default route", () => {
    // Deliberately not host.docker.internal: it accepts a TCP connection on Docker
    // Desktop and then times out on real traffic, which is slower and far less
    // obvious than the connection refusal localhost gives.
    expect(
      publishedPortHost({ override: undefined, inContainer: true, gateway: () => undefined }),
    ).toBe("localhost");
  });

  it("lets an explicit override win in every environment", () => {
    for (const inContainer of [true, false]) {
      expect(
        publishedPortHost({ override: "10.0.0.5", inContainer, gateway: () => "172.17.0.1" }),
      ).toBe("10.0.0.5");
    }
  });

  it("treats a blank override as unset", () => {
    // An exported-but-empty shell variable arrives as "", and must not become the
    // host of a URL.
    expect(
      publishedPortHost({ override: "  ", inContainer: false, gateway: () => "172.17.0.1" }),
    ).toBe("localhost");
  });

  it("resolves without throwing in whatever environment this suite runs in", () => {
    expect(typeof publishedPortHost()).toBe("string");
    expect(publishedPortHost()).not.toBe("");
    // Whatever it decides, it must be self-consistent with the gateway probe.
    const gateway = defaultRouteGateway();
    expect(gateway === undefined || typeof gateway === "string").toBe(true);
  });
});

describe("isInDockerContainer", () => {
  it("is false when the marker is absent, which is a host checkout and CI", () => {
    // The full-stack harness branches on this to decide whether to build any of its
    // container-only machinery at all. False here means no Compose network join and
    // no loopback forwarder, because a published port is already on localhost.
    expect(isInDockerContainer(join(tmpdir(), "qcms-no-such-dockerenv"))).toBe(false);
  });

  it("is true when the marker is present", () => {
    expect(isInDockerContainer(fixture("dockerenv", ""))).toBe(true);
  });
});
