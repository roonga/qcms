/**
 * MUST be imported before any `@testcontainers/*` import, which reads the Docker auth config
 * once at its own module load.
 *
 * Only public images are booted, so an empty config forces an anonymous pull and skips the
 * `docker-credential-desktop` helper that fails to spawn on Windows.
 */
if (!process.env.DOCKER_AUTH_CONFIG && !process.env.DOCKER_CONFIG) {
  process.env.DOCKER_AUTH_CONFIG = "{}";
}
