export interface ReviewRequestedEvent {
  type: 'ReviewRequested';
  payload: {
    correlationId: string;
    repository: string;
    prNumber: number;
    prTitle: string;
    prBody: string | null;
    author: string;
    baseBranch: string;
    headBranch: string;
    headSha: string;
    requestedAt: string;
  };
}

export interface ReviewCompletedEvent {
  type: 'ReviewCompleted';
  payload: {
    correlationId: string;
    repository: string;
    prNumber: number;
    decision: 'APPROVE' | 'REQUEST_CHANGES';
    score: number;
    commentsCount: number;
    completedAt: string;
  };
}

export interface ReviewFailedEvent {
  type: 'ReviewFailed';
  payload: {
    correlationId: string;
    repository: string;
    prNumber: number;
    error: string;
    failedAt: string;
  };
}

export type DomainEvent = ReviewRequestedEvent | ReviewCompletedEvent | ReviewFailedEvent;

export const EVENT_TYPES = {
  REVIEW_REQUESTED: 'ReviewRequested',
  REVIEW_COMPLETED: 'ReviewCompleted',
  REVIEW_FAILED: 'ReviewFailed',
} as const;
