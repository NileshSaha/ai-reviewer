export type ReviewDecision = 'APPROVE' | 'REQUEST_CHANGES';
export type IssueSeverity = 'critical' | 'major' | 'minor';

export interface AIReviewComment {
  file: string;
  line: number;
  text: string;
}

export interface ReviewIssue {
  severity: IssueSeverity;
  file: string;
  line?: number;
  description: string;
  suggestion?: string;
}

export interface AIReviewResult {
  score: number;
  summary: string;
  verdict: ReviewDecision;
  strengths: string[];
  issues: ReviewIssue[];
  security: string | null;
  performance: string | null;
  comments: AIReviewComment[];
  overallComment: string;
  provider?: string;
}

export interface PRDetails {
  repository: string;
  prNumber: number;
  title: string;
  body: string | null;
  author: string;
  baseBranch: string;
  headBranch: string;
  lastReviewedSha?: string;
}

export interface DiffContent {
  files: Array<{
    filename: string;
    patch: string | null;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
  }>;
}