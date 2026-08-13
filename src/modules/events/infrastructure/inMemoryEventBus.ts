import { EventBus, EventHandler } from '../application/eventBus';
import { DomainEvent } from '../application/types';
import { Logger } from '../../../shared/types/logger';

type Subscription = {
  handler: EventHandler<DomainEvent>;
};

export class InMemoryEventBus implements EventBus {
  private subscriptions: Map<string, Subscription[]> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async publish<T extends DomainEvent>(event: T): Promise<void> {
    const eventType = event.type;
    const handlers = this.subscriptions.get(eventType) || [];

    this.logger.debug(`Event published: ${eventType}`, {
      correlation_id: (event as any).payload?.correlationId,
    });

    if (handlers.length === 0) {
      this.logger.warn(`No handlers subscribed for event: ${eventType}`);
      return;
    }

    const promises = handlers.map(async (subscription) => {
      try {
        await subscription.handler(event);
      } catch (error) {
        this.logger.error(`Handler failed for event: ${eventType}`, {
          error: error instanceof Error ? error.message : String(error),
          correlation_id: (event as any).payload?.correlationId,
        });
      }
    });

    await Promise.all(promises);
  }

  async subscribe<T extends DomainEvent>(
    eventType: string,
    handler: EventHandler<T>
  ): Promise<() => Promise<void>> {
    const subscription: Subscription = {
      handler: handler as EventHandler<DomainEvent>,
    };

    const existing = this.subscriptions.get(eventType) || [];
    this.subscriptions.set(eventType, [...existing, subscription]);

    this.logger.debug(`Handler subscribed for event: ${eventType}`);

    return async () => {
      await this.unsubscribe(eventType);
    };
  }

  async unsubscribe(eventType: string): Promise<void> {
    this.subscriptions.delete(eventType);
    this.logger.debug(`All handlers unsubscribed for event: ${eventType}`);
  }

  async clearAll(): Promise<void> {
    this.subscriptions.clear();
    this.logger.debug('All event handlers cleared');
  }
}
