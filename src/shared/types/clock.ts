export interface Clock {
  now(): Date;
  nowISO(): string;
  nowUnix(): number;
}

export const CLOCK_TOKEN = Symbol('Clock');
