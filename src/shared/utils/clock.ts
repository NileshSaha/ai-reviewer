import { Clock } from '../../shared/types/clock';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowISO(): string {
    return new Date().toISOString();
  }

  nowUnix(): number {
    return Math.floor(Date.now() / 1000);
  }
}
