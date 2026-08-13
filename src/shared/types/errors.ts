export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 'NOT_FOUND', 404);
  }
}

export class GitHubAPIError extends AppError {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retryable: boolean = false
  ) {
    super(message, 'GITHUB_API_ERROR', statusCode);
  }
}

export class RateLimitError extends GitHubAPIError {
  constructor(
    public readonly resetAt: Date,
    public readonly retryAfterSeconds?: number
  ) {
    super('GitHub API rate limit exceeded', 403, true);
  }
}

export class AIProviderError extends AppError {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly retryable: boolean = false
  ) {
    super(message, 'AI_PROVIDER_ERROR', 502);
  }
}

export class PersistenceError extends AppError {
  constructor(message: string) {
    super(message, 'PERSISTENCE_ERROR', 500, false);
  }
}
