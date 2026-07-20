/**
 * An injected clock (task 017). Time is a dependency, not an ambient call, so
 * schedulers and handlers stay testable with a controllable `now`. Mirrors the
 * "mocks are for genuine externals (HTTP receivers, clocks)" rule in
 * CONTRIBUTING.
 */
export interface Clock {
  now(): Date;
}

/** The real clock - the only place production reads wall time. */
export const systemClock: Clock = {
  now: () => new Date(),
};
