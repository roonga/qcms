import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const project = "qcms-compose-e2e";
const dockerForWindows =
  process.env.ProgramFiles === undefined
    ? undefined
    : join(process.env.ProgramFiles, "Docker", "Docker", "resources", "bin", "docker.exe");
const docker =
  process.env.QCMS_DOCKER_BIN ??
  (process.platform === "win32" && dockerForWindows !== undefined && existsSync(dockerForWindows)
    ? dockerForWindows
    : "docker");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const pnpmEntrypoint = process.env.npm_execpath;
const compose = ["compose", "--project-name", project, "--env-file", ".env.compose.example"];
const credentialsPath = join(root, ".e2e-compose-credentials.json");
const e2eEnvironment = {
  ...process.env,
  QCMS_ADMIN_PORT: "17940",
  QCMS_PORTAL_PORT: "17900",
  QCMS_ADMIN_BASE_URL: "http://localhost:17940",
  QCMS_PORTAL_BASE_URL: "http://localhost:17900",
};

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, { cwd: root, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function up() {
  // This stack is test-only. Removing its named volume makes each browser run
  // independent, including the first-admin bootstrap state.
  down();
  run(docker, [...compose, "up", "--detach", "--build", "--wait"], e2eEnvironment);
  const credentials = {
    email: `compose.e2e.${Date.now().toString(36)}@admin.test`,
    password: `e2e-${randomBytes(24).toString("base64url")}`,
  };
  writeFileSync(credentialsPath, `${JSON.stringify(credentials)}\n`, { mode: 0o600 });
  run(
    docker,
    [
      ...compose,
      "exec",
      "--no-TTY",
      "--env",
      `QCMS_ADMIN_EMAIL=${credentials.email}`,
      "--env",
      `QCMS_ADMIN_PASSWORD=${credentials.password}`,
      "admin",
      "node",
      "scripts/create-admin.ts",
    ],
    e2eEnvironment,
  );
  process.stdout.write(`E2E admin: ${credentials.email}\nE2E password: ${credentials.password}\n`);
}

function down() {
  run(docker, [...compose, "down", "--volumes", "--remove-orphans"], e2eEnvironment);
  if (existsSync(credentialsPath)) unlinkSync(credentialsPath);
}

function buildTestDependencies() {
  // Playwright imports the admin's auth helper in its host-side setup. Unlike the
  // Compose images, that process resolves workspace packages from their local
  // dist directories, so build the database package and its workspace closure
  // before starting the runner.
  const args = ["--filter", "@qcms/db...", "build"];
  if (pnpmEntrypoint !== undefined) run(process.execPath, [pnpmEntrypoint, ...args], e2eEnvironment);
  else run(pnpm, args, e2eEnvironment);
}

function test({ headed = false } = {}) {
  buildTestDependencies();
  const args = [
    "exec",
    "playwright",
    "test",
    "--config=playwright.compose.config.ts",
    ...(headed ? ["--headed"] : []),
  ];
  if (pnpmEntrypoint !== undefined)
    run(process.execPath, [pnpmEntrypoint, ...args], e2eEnvironment);
  else run(pnpm, args, e2eEnvironment);
}

function runComplete({ headed = false } = {}) {
  try {
    up();
    test({ headed });
  } finally {
    down();
  }
}

const command = process.argv[2];
if (command === "up") up();
else if (command === "down") down();
else if (command === "test") test();
else if (command === "test-headed") test({ headed: true });
else if (command === "run") runComplete();
else if (command === "run-headed") runComplete({ headed: true });
else
  throw new Error("Usage: node scripts/compose-e2e.mjs <up|down|test|test-headed|run|run-headed>");
