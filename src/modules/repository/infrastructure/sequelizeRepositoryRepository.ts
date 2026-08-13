import { RepositoryRepository } from '../application/repositoryRepository';
import { RepositoryModel } from '../../../database/models/repository';
import { RepositoryConfig } from '../../../config/types';
import { GitHubRepository } from '../../github/domain/githubEntities';
import { Logger } from '../../../shared/types/logger';

export class SequelizeRepositoryRepository implements RepositoryRepository {
  constructor(private logger: Logger) {}

  async syncFromGitHub(repos: GitHubRepository[]): Promise<void> {
    this.logger.info(`Syncing ${repos.length} repositories from GitHub`);

    for (const repo of repos) {
      const [_, created] = await RepositoryModel.upsert({
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
      });

      if (created) {
        this.logger.debug(`New repository added: ${repo.fullName}`);
      }
    }

    this.logger.info('Repository sync completed');
  }

  async getPollable(): Promise<RepositoryConfig[]> {
    const models = await RepositoryModel.findAll({
      where: { isPollCheck: true },
    });

    return models.map((m) => ({
      owner: m.owner,
      repo: m.name,
    }));
  }
}
