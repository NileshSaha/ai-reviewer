export interface GitHubRepository {
  owner: string;
  name: string;
  fullName: string;
  isPrivate: boolean;
}

export interface GitHubUser {
  login: string;
  id: number;
  avatarUrl: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  author: GitHubUser;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  state: 'open' | 'closed' | 'merged';
  isDraft: boolean;
  createdAt: Date;
  updatedAt: Date;
  requestedReviewers: GitHubUser[];
}

export interface GitHubFile {
  filename: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  patch?: string;
  contentsUrl: string;
}

export interface GitHubReviewComment {
  path: string;
  line: number;
  body: string;
}

export interface GitHubReviewInput {
  body: string;
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  comments?: GitHubReviewComment[];
}

export interface GitHubReview {
  id: number;
  user: GitHubUser;
  body: string | null;
  event: string;
  submittedAt: Date;
}
