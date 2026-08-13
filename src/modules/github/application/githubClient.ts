import { GitHubRepository, GitHubPullRequest, GitHubFile, GitHubReviewInput, GitHubReview } from '../domain/githubEntities';

export interface GitHubClient {
  getAuthenticatedUser(): Promise<{ login: string }>;

  getRepository(owner: string, repo: string): Promise<GitHubRepository>;

  listCollaboratorRepositories(username: string): Promise<GitHubRepository[]>;

  listPullRequestsWithReviewRequests(
    owner: string,
    repo: string,
    username: string
  ): Promise<GitHubPullRequest[]>;

  getPullRequest(owner: string, repo: string, prNumber: number): Promise<GitHubPullRequest>;

  getPullRequestFiles(owner: string, repo: string, prNumber: number): Promise<GitHubFile[]>;

  getPullRequestDiff(owner: string, repo: string, prNumber: number): Promise<string>;

  createReview(owner: string, repo: string, prNumber: number, review: GitHubReviewInput): Promise<GitHubReview>;

  getRateLimitStatus(): Promise<{
    limit: number;
    remaining: number;
    resetAt: Date;
  }>;

  validateAuth(): Promise<{ valid: boolean; error?: string }>;
}

export { GitHubRepository, GitHubPullRequest, GitHubFile, GitHubReviewInput, GitHubReview };
export const GITHUB_CLIENT_TOKEN = Symbol('GitHubClient');
