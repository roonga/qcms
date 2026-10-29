export interface Clock {
  now(): Date;
}

// The only place production reads wall time.
export const systemClock: Clock = {
  now: () => new Date(),
};
