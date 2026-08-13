import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  COMPOSE_FILES,
  SUPPLIED_VARIABLES,
  devStackBannerLines,
  devStackEnvironmentOverrides,
  missingVariables,
  parseEnvFile,
  pinAdminAuthSecret,
  pinNoticeLines,
  preflightMessage,
  requiredVariables,
  requiredVariablesIn,
  seatPorts,
  teardownPlaceholders,
} from "./dev-compose.mjs";
import { composeProjectName, localStackProjectName, stablePort } from "./ports.mjs";

const scratch = mkdtempSync(join(tmpdir(), "qcms-dev-compose-"));

/** A file's permission bits, which is all these assertions are ever about. */
const mode = (path: string): number => statSync(path).mode & 0o777;
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("localStackProjectName", () => {
  it("names seat 0's stack something a person recognises in docker compose ls", () => {
    expect(localStackProjectName(0)).toBe("qcms-local-stack");
  });

  it("gives every other seat its own project, so down --volumes cannot cross lanes", () => {
    const names = new Set([0, 1, 2, 9].map((seat) => localStackProjectName(seat)));
    expect(names.size).toBe(4);
    expect(localStackProjectName(3)).toBe("qcms-local-stack-s3");
  });

  // The collision that would actually hurt: `down --volumes --remove-orphans` under
  // a shared name deletes the other stack rather than reading it.
  it("collides with neither the dev database nor the full-stack e2e stack, at any seat", () => {
    for (const seat of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const local = localStackProjectName(seat);
      expect(local).not.toBe(composeProjectName(seat));
      expect(local).not.toBe(`${composeProjectName(seat)}-full-stack-e2e`);
    }
  });
});

describe("seatPorts", () => {
  it("derives all four from the allocation rather than writing any of them down", () => {
    expect(seatPorts(3)).toEqual({
      portal: stablePort("portal", 3),
      admin: stablePort("admin", 3),
      observability: stablePort("observability", 3),
      dbViewer: stablePort("dbViewer", 3),
    });
  });

  it("moves every port together when the seat moves", () => {
    const zero = Object.values(seatPorts(0));
    const seven = Object.values(seatPorts(7));
    expect(zero.some((port) => seven.includes(port))).toBe(false);
  });
});

describe("devStackEnvironmentOverrides", () => {
  const ports = seatPorts(2);
  const overrides = devStackEnvironmentOverrides({ ports, adminAuthSecret: "pinned-secret" });

  // better-auth trusts the admin origin and no other, so a base URL that disagreed
  // with the published port would be a sign-in that redirects forever.
  it("keeps each base URL on the port that service is actually published on", () => {
    expect(overrides.QCMS_ADMIN_BASE_URL).toBe(`http://localhost:${String(ports.admin)}`);
    expect(overrides.QCMS_PORTAL_BASE_URL).toBe(`http://localhost:${String(ports.portal)}`);
    expect(overrides.QCMS_ADMIN_PORT).toBe(String(ports.admin));
    expect(overrides.QCMS_PORTAL_PORT).toBe(String(ports.portal));
  });

  it("publishes the two toolbox services on this seat's slots", () => {
    expect(overrides.QCMS_OBSERVABILITY_PORT).toBe(String(ports.observability));
    expect(overrides.QCMS_DB_VIEWER_PORT).toBe(String(ports.dbViewer));
  });

  // This stack prints a plaintext administrator credential and runs a Grafana whose
  // login is admin/admin. A .env copied from the operator template may legitimately
  // say 0.0.0.0; here it must not win.
  it("pins the bind address to loopback whatever .env says", () => {
    expect(overrides.QCMS_BIND_ADDRESS).toBe("127.0.0.1");
  });

  it("carries the pinned auth secret, so the API cannot generate a fresh one", () => {
    expect(overrides.QCMS_ADMIN_AUTH_SECRET).toBe("pinned-secret");
  });
});

describe("requiredVariables", () => {
  it("finds the variables Compose refuses to default", () => {
    expect(requiredVariablesIn("A: ${FOO:?set FOO}\nB: ${BAR:-default}\nC: ${FOO:?again}")).toEqual(
      ["FOO"],
    );
  });

  it("ignores a plain interpolation and a defaulted one", () => {
    expect(requiredVariablesIn("${QCMS_BIND_ADDRESS:-127.0.0.1} ${PLAIN}")).toEqual([]);
  });

  // The preflight exists to name the two variables the overlay demands; if the scan
  // stopped finding them the message would go quiet and Compose's would come back.
  it("names the database password and the viewer password from the real files", () => {
    const required = requiredVariables();
    expect(required).toContain("QCMS_DB_PASSWORD");
    expect(required).toContain("QCMS_DB_VIEWER_PASSWORD");
  });

  it("never demands a value this command supplies itself", () => {
    const required = requiredVariables();
    for (const supplied of SUPPLIED_VARIABLES) expect(required).not.toContain(supplied);
    // ... and those really are demanded by the files, so the subtraction is doing work.
    const raw = COMPOSE_FILES.flatMap((file) =>
      requiredVariablesIn(readFileSync(join(import.meta.dirname, "..", file), "utf8")),
    );
    expect(raw).toContain("QCMS_ADMIN_AUTH_SECRET");
    expect(raw).toContain("QCMS_ADMIN_BASE_URL");
  });
});

describe("parseEnvFile and missingVariables", () => {
  it("reads pairs and skips comments and blanks", () => {
    expect(parseEnvFile("# note\n\nA=1\nB = two \n")).toEqual({ A: "1", B: "two" });
  });

  it("strips one layer of surrounding quotes", () => {
    expect(parseEnvFile(`A="quoted"\nB='single'`)).toEqual({ A: "quoted", B: "single" });
  });

  it("keeps an = inside a value, which secrets contain", () => {
    expect(parseEnvFile("A=abc=def==").A).toBe("abc=def==");
  });

  it("counts an empty value as missing, not as supplied", () => {
    expect(missingVariables(["A"], { A: "" }, {})).toEqual(["A"]);
    expect(missingVariables(["A"], { A: "   " }, {})).toEqual(["A"]);
  });

  it("lets the shell environment satisfy a variable the file lacks", () => {
    expect(missingVariables(["A"], {}, { A: "from-shell" })).toEqual([]);
  });

  it("lets the file satisfy one the shell lacks", () => {
    expect(missingVariables(["A"], { A: "from-file" }, {})).toEqual([]);
  });
});

describe("preflightMessage", () => {
  it("names every missing variable", () => {
    const message = preflightMessage(["QCMS_DB_PASSWORD", "QCMS_DB_VIEWER_PASSWORD"], true);
    expect(message).toContain("QCMS_DB_PASSWORD");
    expect(message).toContain("QCMS_DB_VIEWER_PASSWORD");
  });

  // The sharp case: the viewer password is deliberately absent from the operator
  // template, so "copy the example" does not produce it and Compose's own error
  // gives the reader no way to discover that.
  it("says where the viewer password is documented, since the template does not carry it", () => {
    const message = preflightMessage(["QCMS_DB_VIEWER_PASSWORD"], true);
    expect(message).toContain("docs/DEVELOPER_GUIDE.md");
    expect(message).toContain("NOT in that template");
  });

  it("offers the copy step only when there is no .env at all", () => {
    expect(preflightMessage(["QCMS_DB_PASSWORD"], false)).toContain("cp .env.compose.example");
    expect(preflightMessage(["QCMS_DB_PASSWORD"], true)).not.toContain("cp .env.compose.example");
  });

  // Inventing one would put a read-only database client in everybody's stack, which
  // is exactly what leaving the variable undefaulted in the overlay prevents.
  it("suggests generating a value and never supplies one", () => {
    const message = preflightMessage(["QCMS_DB_VIEWER_PASSWORD"], true);
    expect(message).toContain("openssl rand");
    expect(message).toContain("Nothing in this repo picks one for you");
  });
});

describe("pinAdminAuthSecret", () => {
  it("prefers a secret the developer exported", () => {
    const path = join(scratch, "ambient");
    expect(pinAdminAuthSecret({ environment: { QCMS_ADMIN_AUTH_SECRET: "mine" }, path })).toEqual({
      secret: "mine",
      source: "environment",
    });
  });

  it("generates one on first use and writes it where the next run will find it", () => {
    const path = join(scratch, "generated");
    const first = pinAdminAuthSecret({ environment: {}, path });
    expect(first.source).toBe("generated");
    expect(first.secret.length).toBeGreaterThan(30);

    const second = pinAdminAuthSecret({ environment: {}, path });
    expect(second).toEqual({ secret: first.secret, source: "file" });
  });

  // The whole point of pinning: a fresh value per run makes an enrolled
  // authenticator permanently unverifiable and burns a recovery code each restart.
  it("returns the same value across runs, which is what keeps an enrolment alive", () => {
    const path = join(scratch, "stable");
    const runs = new Set(
      Array.from({ length: 5 }, () => pinAdminAuthSecret({ environment: {}, path }).secret),
    );
    expect(runs.size).toBe(1);
  });

  it("writes the file readable only by its owner", () => {
    const path = join(scratch, "mode");
    pinAdminAuthSecret({ environment: {}, path });
    expect(mode(path)).toBe(0o600);
  });

  /**
   * The regression this suite exists for.
   *
   * `writeFileSync`'s `mode` option applies ONLY when the call creates the file; on
   * an existing one it is silently ignored (measured: a 0644 file rewritten with
   * `{ mode: 0o600 }` stays 0644). So a test that only ever exercises the create path
   * passes with or without the fix and proves nothing. Each case below starts from a
   * file that already exists at a wider mode, which is the state a real machine is
   * in: the repository root of the machine this was written on had `.env.dev-admin`
   * at 0644 holding a live secret.
   */
  describe("an existing pin file at a wider mode", () => {
    it("is tightened to owner-only when it is read", () => {
      const path = join(scratch, "loose-read");
      writeFileSync(path, "QCMS_ADMIN_AUTH_SECRET=already-pinned\n");
      chmodSync(path, 0o644);

      const result = pinAdminAuthSecret({ environment: {}, path });

      expect(result.source).toBe("file");
      expect(result.secret).toBe("already-pinned");
      expect(mode(path)).toBe(0o600);
    });

    it("reports what it tightened, so the change is not silent", () => {
      const path = join(scratch, "loose-report");
      writeFileSync(path, "QCMS_ADMIN_AUTH_SECRET=already-pinned\n");
      chmodSync(path, 0o644);
      expect(pinAdminAuthSecret({ environment: {}, path }).tightenedFrom).toBe("644");
    });

    it("is tightened on the REGENERATE path too, where `mode` is ignored outright", () => {
      // Empty value, so the secret is regenerated into a file that already exists -
      // exactly the call where writeFileSync's mode option does nothing at all.
      const path = join(scratch, "loose-write");
      writeFileSync(path, "QCMS_ADMIN_AUTH_SECRET=\n");
      chmodSync(path, 0o646);

      expect(pinAdminAuthSecret({ environment: {}, path }).source).toBe("generated");
      expect(mode(path)).toBe(0o600);
    });

    it("says nothing when the file was already owner-only", () => {
      const path = join(scratch, "already-tight");
      writeFileSync(path, "QCMS_ADMIN_AUTH_SECRET=already-pinned\n");
      chmodSync(path, 0o600);
      expect(pinAdminAuthSecret({ environment: {}, path }).tightenedFrom).toBeUndefined();
    });

    // Tightening must never be a way of handing back a write bit a developer removed.
    it("does not loosen a deliberately read-only file", () => {
      const path = join(scratch, "read-only");
      writeFileSync(path, "QCMS_ADMIN_AUTH_SECRET=already-pinned\n");
      chmodSync(path, 0o400);
      expect(pinAdminAuthSecret({ environment: {}, path }).tightenedFrom).toBeUndefined();
      expect(mode(path)).toBe(0o400);
    });
  });

  // Regenerating on an unreadable file would overwrite a secret this process could
  // not read, which is the enrolment-destroying outcome the pin exists to prevent.
  it("rethrows a failure that is not a missing file rather than regenerating", () => {
    const path = join(scratch, "a-directory");
    mkdirSync(path, { recursive: true });
    expect(() => pinAdminAuthSecret({ environment: {}, path })).toThrow();
  });

  it("regenerates rather than returning an empty stored value", () => {
    const path = join(scratch, "empty");
    writeFileSync(path, "QCMS_ADMIN_AUTH_SECRET=\n");
    expect(pinAdminAuthSecret({ environment: {}, path }).source).toBe("generated");
  });
});

describe("devStackBannerLines", () => {
  const ports = seatPorts(0);
  const banner = (
    credentials: { email: string; password: string } | undefined,
    inContainer = false,
  ): string =>
    devStackBannerLines({
      ports,
      project: localStackProjectName(0),
      credentials,
      inContainer,
    }).join("\n");

  const created = banner({ email: "dev@qcms.test", password: "dev-secret-value" });

  it("prints all four URLs a person can open", () => {
    for (const port of Object.values(ports)) expect(created).toContain(`localhost:${String(port)}`);
  });

  it("names the Compose project, which is what dev:down addresses", () => {
    expect(created).toContain("qcms-local-stack");
  });

  it("prints the credential this run created", () => {
    expect(created).toContain("dev@qcms.test");
    expect(created).toContain("dev-secret-value");
  });

  // The three things a developer would otherwise report as broken.
  it("warns that first sign-in forces TOTP enrolment with codes shown once", () => {
    expect(created).toContain("authenticator app");
    expect(created).toMatch(/TOTP enrolment/i);
    expect(created).toMatch(/recovery codes are shown exactly once/i);
  });

  it("says where safe application logs and their traces are available", () => {
    expect(created).toContain("admin / admin");
    expect(created).toContain("Observability home dashboard");
    expect(created).toContain("Explore -> Loki");
    expect(created).toContain("qcms-admin");
    expect(created).toContain("no answers, PII or secrets");
  });

  it("explains the skip when an administrator already existed", () => {
    const skipped = banner(undefined);
    expect(skipped).toContain("already had an administrator");
    expect(skipped).toContain("pnpm dev:down");
    expect(skipped).not.toContain("password  ");
  });

  it("tells a dev-container reader that the ports are on the host's loopback", () => {
    expect(banner(undefined, true)).toContain("HOST's");
    expect(banner(undefined, false)).not.toContain("HOST's");
  });

  it("always says how to stop it", () => {
    expect(created).toContain("pnpm dev:down");
  });
});

describe("teardownPlaceholders", () => {
  // The failure this exists to prevent: a .env edited after the stack came up would
  // make `docker compose down` fail on a `:?` variable, leaving a running stack the
  // documented command cannot stop.
  it("fills only what is genuinely absent", () => {
    expect(teardownPlaceholders(["A", "B"], { A: "real" }, {})).toEqual({
      B: "unused-during-teardown",
    });
  });

  it("fills nothing when the environment already has everything", () => {
    expect(teardownPlaceholders(["A"], {}, { A: "from-shell" })).toEqual({});
  });

  it("fills every required variable when there is no .env at all", () => {
    const filled = teardownPlaceholders(requiredVariables(), {}, {});
    expect(Object.keys(filled).sort()).toEqual([...requiredVariables()].sort());
  });
});

describe("pinNoticeLines", () => {
  it("names the rung the secret came from", () => {
    expect(pinNoticeLines({ source: "environment" })[0]).toContain("from your environment");
    expect(pinNoticeLines({ source: "file" })[0]).toContain(".env.dev-admin");
    expect(pinNoticeLines({ source: "generated" })[0]).toContain("generated and written");
  });

  it("says nothing extra when no mode was changed", () => {
    expect(pinNoticeLines({ source: "file" })).toHaveLength(1);
  });

  it("reports a tightened mode on its own line, naming the old one", () => {
    const lines = pinNoticeLines({ source: "file", tightenedFrom: "644" });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("644");
    expect(lines[1]).toContain("owner-only");
  });

  // SEC-8: these lines name the variable, the file and the mode, never the value.
  it("never prints the secret", () => {
    const text = pinNoticeLines({ source: "file", tightenedFrom: "644" }).join("\n");
    expect(text).not.toMatch(/=[A-Za-z0-9_-]{20,}/);
  });
});
