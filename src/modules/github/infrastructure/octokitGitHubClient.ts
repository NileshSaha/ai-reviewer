import { Octokit } from '@octokit/rest';
import {
  GitHubClient,
  GitHubRepository,
  GitHubPullRequest,
  GitHubFile,
  GitHubReviewInput,
  GitHubReview,
} from '../application/githubClient';
import { GitHubRepository as GitHubRepoEntity, GitHubPullRequest as GHPREntity, GitHubUser, GitHubFile as GHFile } from '../domain/githubEntities';
import { Logger } from '../../../shared/types/logger';
import { GitHubAPIError, RateLimitError } from '../../../shared/types/errors';
import { Clock } from '../../../shared/types/clock';

const RETRYABLE_STATUS_CODES = [500, 502, 503, 504];
const MAX_RETRIES = 3;
const RATE_LIMIT_THRESHOLD = 10;

export class OctokitGitHubClient implements GitHubClient {
  private client: Octokit;
  private logger: Logger;

  constructor(
    pat: string,
    logger: Logger,
    private clock: Clock
  ) {
    this.client = new Octokit({ auth: pat });
    this.logger = logger;
  }

  async getAuthenticatedUser(): Promise<{ login: string }> {
    const response = await this.requestWithRetry(() =>
      this.client.users.getAuthenticated()
    );
    return { login: response.data.login };
  }

  async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
    const response = await this.requestWithRetry(() =>
      this.client.repos.get({ owner, repo })
    );

    return {
      owner: response.data.owner.login,
      name: response.data.name,
      fullName: response.data.full_name,
      isPrivate: response.data.private,
    };
  }

  async listCollaboratorRepositories(username: string): Promise<GitHubRepository[]> {
    const repos: GitHubRepository[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const response = await this.requestWithRetry(() =>
        this.client.repos.listForAuthenticatedUser({
          username,
          per_page: perPage,
          page,
          sort: 'updated',
        })
      );

      repos.push(
        ...response.data.map((r) => ({
          owner: r.owner.login,
          name: r.name,
          fullName: r.full_name,
          isPrivate: r.private,
        }))
      );

      if (response.data.length < perPage) break;
      page++;
    }

    this.logger.debug(`Listed ${repos.length} repositories for user: ${username}`);
    return repos;
  }

  async listPullRequestsWithReviewRequests(
    owner: string,
    repo: string,
    username: string
  ): Promise<GitHubPullRequest[]> {
    const prs: GitHubPullRequest[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const response = await this.requestWithRetry(() =>
        this.client.pulls.list({
          owner,
          repo,
          state: 'open',
          per_page: perPage,
          page,
        })
      );

      for (const pr of response.data) {
        if (pr.user?.login === username) continue;
        if (pr.draft) continue;

        const requestedReviewers = await this.getRequestedReviewers(owner, repo, pr.number);
        if (requestedReviewers.some((r) => r.login === username)) {
          prs.push(this.mapPullRequest(pr));
        }
      }

      if (response.data.length < perPage) break;
      page++;
    }

    this.logger.debug(`Found ${prs.length} PRs with review requests in ${owner}/${repo}`);
    return prs;
  }

  private async getRequestedReviewers(owner: string, repo: string, prNumber: number): Promise<GitHubUser[]> {
    try {
      const response = await this.requestWithRetry(() =>
        this.client.pulls.listRequestedReviewers({
          owner,
          repo,
          pull_number: prNumber,
        })
      );
      return response.data.users.map((u) => ({
        login: u.login,
        id: u.id,
        avatarUrl: u.avatar_url,
      }));
    } catch {
      return [];
    }
  }

  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<GitHubPullRequest> {
    const response = await this.requestWithRetry(() =>
      this.client.pulls.get({ owner, repo, pull_number: prNumber })
    );
    return this.mapPullRequest(response.data);
  }

  async getPullRequestFiles(owner: string, repo: string, prNumber: number): Promise<GitHubFile[]> {
    const files: GitHubFile[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const response = await this.requestWithRetry(() =>
        this.client.pulls.listFiles({
          owner,
          repo,
          pull_number: prNumber,
          per_page: perPage,
          page,
        })
      );

      files.push(
        ...response.data.map((f) => ({
          filename: f.filename,
          status: f.status as GitHubFile['status'],
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch,
          contentsUrl: f.contents_url,
        }))
      );

      if (response.data.length < perPage) break;
      page++;
    }

    return files;
  }

  async getPullRequestDiff(owner: string, repo: string, prNumber: number): Promise<string> {
    const response = await this.requestWithRetry(() =>
      this.client.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
        mediaType: { format: 'diff' },
      })
    );
    return response.data as unknown as string;
  }

  async createReview(
    owner: string,
    repo: string,
    prNumber: number,
    review: GitHubReviewInput
  ): Promise<GitHubReview> {
    const hasComments = !!(review.comments && review.comments.length > 0);
    try {
      const response = await this.requestWithRetry(() =>
        this.client.pulls.createReview({
          owner,
          repo,
          pull_number: prNumber,
          body: review.body,
          event: review.event,
          comments: hasComments
            ? review.comments!.map((c) => ({
                path: c.path,
                line: c.line,
                body: c.body,
              }))
            : undefined,
        })
      );

      return {
        id: response.data.id,
        user: {
          login: response.data.user?.login ?? 'unknown',
          id: response.data.user?.id ?? 0,
          avatarUrl: response.data.user?.avatar_url ?? '',
        },
        body: response.data.body,
        event: review.event,
        submittedAt: new Date(response.data.submitted_at ?? Date.now()),
      };
    } catch (error: any) {
      if (hasComments && this.isCommentResolutionError(error)) {
        this.logger.warn(
          `Review submission with inline comments failed (${error?.message ?? error}). Retrying review submission without inline comments.`,
          { owner, repo, prNumber, commentCount: review.comments!.length }
        );

        const fallbackResponse = await this.requestWithRetry(() =>
          this.client.pulls.createReview({
            owner,
            repo,
            pull_number: prNumber,
            body: review.body,
            event: review.event,
          })
        );

        return {
          id: fallbackResponse.data.id,
          user: {
            login: fallbackResponse.data.user?.login ?? 'unknown',
            id: fallbackResponse.data.user?.id ?? 0,
            avatarUrl: fallbackResponse.data.user?.avatar_url ?? '',
          },
          body: fallbackResponse.data.body,
          event: review.event,
          submittedAt: new Date(fallbackResponse.data.submitted_at ?? Date.now()),
        };
      }

      throw error;
    }
  }

  private isCommentResolutionError(error: any): boolean {
    const status = error?.statusCode ?? error?.status;
    const message = error?.message || String(error);
    if (status === 422) return true;
    if (message.includes('Line could not be resolved')) return true;
    if (message.includes('Unprocessable Entity')) return true;
    if (message.includes('Validation Failed')) return true;
    return false;
  }

  async getRateLimitStatus(): Promise<{ limit: number; remaining: number; resetAt: Date }> {
    const response = await this.requestWithRetry(() => this.client.rateLimit.get());
    return {
      limit: response.data.rate.limit,
      remaining: response.data.rate.remaining,
      resetAt: new Date(response.data.rate.reset * 1000),
    };
  }

  async validateAuth(): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.requestWithRetry(() => this.client.users.getAuthenticated(), 0);
      return { valid: true };
    } catch (error: any) {
      const status = error?.statusCode ?? error?.status;
      const message = error?.message ?? 'GitHub auth failed';
      if (status === 401) {
        return { valid: false, error: 'Bad credentials (401)' };
      }
      if (status === 403) {
        return { valid: false, error: `Forbidden (403): ${message}` };
      }
      return { valid: false, error: `${status ?? 'error'}: ${message}` };
    }
  }

  private async requestWithRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const rateLimit = await this.getRateLimitStatusInternal();
        if (rateLimit.remaining < RATE_LIMIT_THRESHOLD) {
          const waitMs = Math.max(0, rateLimit.resetAt.getTime() - Date.now());
          this.logger.warn(`Rate limit low (${rateLimit.remaining}), waiting ${waitMs}ms`, {
            remaining: rateLimit.remaining,
            resetAt: rateLimit.resetAt.toISOString(),
          });
          await this.sleep(waitMs);
        }

        return await fn();
      } catch (error: any) {
        const isRetryable = this.isRetryableError(error);
        if (!isRetryable || attempt >= retries) {
          throw this.mapError(error);
        }

        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        this.logger.warn(`Retrying GitHub API request (attempt ${attempt + 1}/${retries})`, {
          error: error.message,
          delay,
        });
        await this.sleep(delay);
      }
    }
    throw new Error('Should not reach here');
  }

  private async getRateLimitStatusInternal(): Promise<{ limit: number; remaining: number; resetAt: Date }> {
    try {
      const response = await this.client.rateLimit.get();
      return {
        limit: response.data.rate.limit,
        remaining: response.data.rate.remaining,
        resetAt: new Date(response.data.rate.reset * 1000),
      };
    } catch {
      return { limit: 5000, remaining: 5000, resetAt: new Date() };
    }
  }

  private isRetryableError(error: any): boolean {
    if (error.status) {
      return RETRYABLE_STATUS_CODES.includes(error.status);
    }
    return false;
  }

  private mapError(error: any): GitHubAPIError {
    const status = error.status ?? 500;
    const message = error.message ?? 'GitHub API error';
    return new GitHubAPIError(message, status, this.isRetryableError(error));
  }

  private mapPullRequest(data: any): GitHubPullRequest {
    return {
      number: data.number,
      title: data.title,
      body: data.body,
      author: {
        login: data.user?.login ?? 'unknown',
        id: data.user?.id ?? 0,
        avatarUrl: data.user?.avatar_url ?? '',
      },
      baseBranch: data.base?.ref ?? 'unknown',
      headBranch: data.head?.ref ?? 'unknown',
      headSha: data.head?.sha ?? '',
      state: data.state as 'open' | 'closed' | 'merged',
      isDraft: data.draft ?? false,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
      requestedReviewers: [],
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
