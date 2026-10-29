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

function fixture(name: string, content: string): string {
  const directory = mkdtempSync(join(tmpdir(), "qcms-docker-host-"));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  writeFileSync(path, content);
  return path;
}

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
    // The kernel prints the 32-bit gateway in HOST byte order, so the low byte is the
    // first octet. Reversed, it yields a plausible address nothing answers on.
    expect(ipv4FromRouteField("010011AC")).toBe("172.17.0.1");
    expect(ipv4FromRouteField("0100007F")).toBe("127.0.0.1");
  });

  it("rejects the all-zero gateway rather than returning 0.0.0.0", () => {
    // An on-link default route has no router address to dial, so returning "0.0.0.0"
    // would look like an answer and connect to nothing.
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
    expect(gatewayFromRouteTable(join(tmpdir(), "qcms-no-such-route-table"))).toBeUndefined();
  });
});

describe("gatewayFromIpRoute", () => {
  it("returns undefined when no candidate binary exists", () => {
    expect(gatewayFromIpRoute([join(tmpdir(), "qcms-no-such-ip")])).toBeUndefined();
  });

  it("agrees with the routing table wherever both can answer", () => {
    // Against the live machine, not a fixture, so a disagreement catches a decoding bug
    // no fixture would. Skipped rather than failed where either mechanism is absent.
    const fromTable = gatewayFromRouteTable();
    const fromCommand = gatewayFromIpRoute();
    if (fromTable === undefined || fromCommand === undefined) return;
    expect(fromTable).toBe(fromCommand);
  });
});

describe("publishedPortHost", () => {
  it("answers localhost on a plain host checkout, without probing anything", () => {
    // Also the CI branch: a runner has a Docker bridge whose gateway is the wrong
    // answer there, so the probe must not even be reached.
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
    expect(
      publishedPortHost({ override: undefined, inContainer: true, gateway: () => "172.17.0.1" }),
    ).toBe("172.17.0.1");
  });

  it("falls back to localhost in a container with no default route", () => {
    // Not host.docker.internal: it accepts a TCP connection and then times out, which
    // is far less obvious than the refusal localhost gives.
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
    // An exported-but-empty shell variable arrives as "" and must not become a URL host.
    expect(
      publishedPortHost({ override: "  ", inContainer: false, gateway: () => "172.17.0.1" }),
    ).toBe("localhost");
  });

  it("resolves without throwing in whatever environment this suite runs in", () => {
    expect(typeof publishedPortHost()).toBe("string");
    expect(publishedPortHost()).not.toBe("");
    const gateway = defaultRouteGateway();
    expect(gateway === undefined || typeof gateway === "string").toBe(true);
  });
});

describe("isInDockerContainer", () => {
  it("is false when the marker is absent, which is a host checkout and CI", () => {
    expect(isInDockerContainer(join(tmpdir(), "qcms-no-such-dockerenv"))).toBe(false);
  });

  it("is true when the marker is present", () => {
    expect(isInDockerContainer(fixture("dockerenv", ""))).toBe(true);
  });
});
