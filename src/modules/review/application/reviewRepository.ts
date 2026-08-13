import { ReviewedPR, ReviewedPRCreate } from '../domain/reviewedPR';

export interface ReviewRepository {
  create(review: ReviewedPRCreate): Promise<ReviewedPR>;
  findByRepoAndPR(repository: string, prNumber: number): Promise<ReviewedPR | null>;
  hasBeenReviewedWithSameSHA(repository: string, prNumber: number, headSha: string): Promise<boolean>;
  update(review: ReviewedPR): Promise<ReviewedPR>;
  delete(id: string): Promise<void>;
  findAll(): Promise<ReviewedPR[]>;
}
