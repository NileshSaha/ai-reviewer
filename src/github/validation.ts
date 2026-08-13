import crypto from 'crypto';
import { createLogger } from '../utils/logger';

const logger = createLogger('WebhookValidation');

export interface WebhookPayload {
  action: string;
  pull_request?: {
    number: number;
    title: string;
    body: string | null;
    user: {
      login: string;
    };
    base: {
      ref: string;
    };
    head: {
      ref: string;
    };
  };
  repository: {
    owner: {
      login: string;
    };
    name: string;
  };
  sender?: {
    login: string;
  };
}

export class WebhookValidator {
  constructor(private secret?: string) {}

  validate(payload: Buffer, signature: string | null): boolean {
    if (!this.secret) {
      logger.warn('No webhook secret configured, skipping validation');
      return true;
    }

    if (!signature) {
      logger.warn('No signature provided in webhook');
      return false;
    }

    const expectedSignature = this.computeSignature(payload);

    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );

    if (!isValid) {
      logger.warn('Invalid webhook signature');
    }

    return isValid;
  }

  private computeSignature(payload: Buffer): string {
    const hmac = crypto.createHmac('sha256', this.secret!);
    hmac.update(payload);
    return `sha256=${hmac.digest('hex')}`;
  }

  parsePayload(payload: WebhookPayload): WebhookPayload {
    return payload;
  }
}
