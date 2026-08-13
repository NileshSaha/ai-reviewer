import { RepositoryConfig } from '../../../config/types';
import { GitHubRepository } from '../../github/domain/githubEntities';

export interface RepositoryRepository {
  syncFromGitHub(repos: GitHubRepository[]): Promise<void>;
  getPollable(): Promise<RepositoryConfig[]>;
}
