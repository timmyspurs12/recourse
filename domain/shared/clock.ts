/**
 * Clock port.
 *
 * Time is an input, never an ambient global. Tests inject a fixed clock so that
 * hashes, deadlines and recourse windows are reproducible.
 */
export interface Clock {
  now(): Date;
  isoNow(): string;
}

export const systemClock: Clock = {
  now: () => new Date(),
  isoNow: () => new Date().toISOString(),
};

export function fixedClock(iso: string): Clock {
  let current = new Date(iso);
  return {
    now: () => new Date(current),
    isoNow: () => current.toISOString(),
    // advance is exposed via the returned object for tests that need it
    ...({
      advance(ms: number) {
        current = new Date(current.getTime() + ms);
      },
    } as object),
  } as Clock & { advance(ms: number): void };
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

export function isBefore(a: string, b: string): boolean {
  return new Date(a).getTime() < new Date(b).getTime();
}
