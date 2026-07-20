/**
 * Side-effect module: MUST be imported before any `@testcontainers/*` import.
 *
 * Testcontainers reads the Docker auth config exactly once, at the module-load
 * of its `get-auth-config` module (a top-level `readDockerConfig()` call). By
 * that point any later `process.env` mutation is too late. We only ever boot a
 * public image (Docker Hub `postgres`), so no registry credentials are needed;
 * an empty `DOCKER_AUTH_CONFIG` forces an anonymous pull and, crucially, skips
 * the credential-helper subprocess (`docker-credential-desktop`) that Docker
 * Desktop configures via `credsStore` and that fails to spawn on Windows. A
 * no-op on Linux CI, where anonymous pulls already work. We never override a
 * config the developer set themselves.
 */
if (!process.env.DOCKER_AUTH_CONFIG && !process.env.DOCKER_CONFIG) {
  process.env.DOCKER_AUTH_CONFIG = "{}";
}
