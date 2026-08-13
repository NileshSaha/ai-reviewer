export interface ReviewedPR {
  id: string;
  repository: string;
  prNumber: number;
  headSha: string;
  reviewedAt: Date;
}

export interface ReviewedPRCreate {
  repository: string;
  prNumber: number;
  headSha: string;
  reviewedAt: Date;
}
