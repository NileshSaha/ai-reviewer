import { DomainEvent } from './types';

export type EventHandler<T extends DomainEvent = DomainEvent> = (event: T) => Promise<void>;

export interface EventBus {
  publish<T extends DomainEvent>(event: T): Promise<void>;
  subscribe<T extends DomainEvent>(
    eventType: string,
    handler: EventHandler<T>
  ): Promise<() => Promise<void>>;
  unsubscribe(eventType: string): Promise<void>;
  clearAll(): Promise<void>;
}

export const EVENT_BUS_TOKEN = Symbol('EventBus');
