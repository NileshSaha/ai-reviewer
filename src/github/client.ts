import { Octokit } from '@octokit/rest';
import { createLogger } from '../utils/logger';

const logger = createLogger('GitHubClient');

export interface PRInfo {
  owner: string;
  repo: string;
  prNumber: number;
  title: string;
  body: string | null;
  author: string;
  baseBranch: string;
  headBranch: string;
}

export interface ReviewComment {
  path: string;
  line: number;
  body: string;
}

export interface ReviewInput {
  body: string;
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  comments?: ReviewComment[];
}

export class GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async getPRDiff(owner: string, repo: string, prNumber: number): Promise<string> {
    logger.debug(`Fetching diff for ${owner}/${repo}#${prNumber}`);

    const response = await this.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: 'diff' },
    });

    return response.data as unknown as string;
  }

  async getPRDetails(owner: string, repo: string, prNumber: number): Promise<PRInfo> {
    logger.debug(`Fetching PR details for ${owner}/${repo}#${prNumber}`);

    const { data } = await this.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    return {
      owner,
      repo,
      prNumber: prNumber,
      title: data.title,
      body: data.body,
      author: data.user?.login ?? 'unknown',
      baseBranch: data.base.ref,
      headBranch: data.head.ref,
    };
  }

  async postReview(
    owner: string,
    repo: string,
    prNumber: number,
    review: ReviewInput
  ): Promise<void> {
    logger.debug(`Posting review for ${owner}/${repo}#${prNumber}`, { event: review.event });

    await this.octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      body: review.body,
      event: review.event,
    });

    logger.info(`Review posted for ${owner}/${repo}#${prNumber}`);
  }

  async postReviewWithComments(
    owner: string,
    repo: string,
    prNumber: number,
    review: ReviewInput
  ): Promise<void> {
    if (!review.comments || review.comments.length === 0) {
      return this.postReview(owner, repo, prNumber, review);
    }

    logger.debug(`Posting review with ${review.comments.length} comments for ${owner}/${repo}#${prNumber}`);

    await this.octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      body: review.body,
      event: review.event,
      comments: review.comments,
    });

    logger.info(`Review with comments posted for ${owner}/${repo}#${prNumber}`);
  }
}
