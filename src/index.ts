import 'reflect-metadata';
import { loadConfig } from './config';
import { createSequelize } from './database/sequelize';
import { initReviewedPRModel, ReviewedPRModel } from './database/models/reviewedPR';
import { initRepositoryModel, RepositoryModel } from './database/models/repository';
import { SequelizeRepositoryRepository } from './modules/repository/infrastructure/sequelizeRepositoryRepository';
import { createLogger } from './shared/utils/logger';
import { SystemClock } from './shared/utils/clock';
import { UUIDAdapter } from './shared/utils/uuid';
import { InMemoryEventBus } from './modules/events/infrastructure/inMemoryEventBus';
import { OctokitGitHubClient } from './modules/github/infrastructure/octokitGitHubClient';
import { createAIProvider } from './modules/ai/infrastructure/aiFactory';
import { SequelizeReviewRepository } from './modules/review/infrastructure/sequelizeReviewRepository';
import { createReviewPipeline } from './modules/review/application/reviewPipeline';
import { createScheduler } from './modules/scheduler/application/schedulerService';
import { createHealthChecker } from './modules/health/application/healthChecker';
import { createExpressApp, errorHandler } from './bootstrap/express';
import { Logger } from './shared/types/logger';
import { Clock } from './shared/types/clock';
import { UUIDGenerator } from './shared/types/uuid';

interface Container {
  logger: Logger;
  clock: Clock;
  uuidGenerator: UUIDGenerator;
  eventBus: InMemoryEventBus;
}

let container: Container;
let scheduler: ReturnType<typeof createScheduler>;

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ module: 'main' });

  logger.info('Starting AI GitHub Reviewer', {
    nodeEnv: config.nodeEnv,
    llmProvider: config.ai.provider,
    pollInterval: config.scheduler.pollIntervalSeconds,
    repositories: config.scheduler.repositories.length,
  });

  const clock = new SystemClock();
  const uuidGenerator = new UUIDAdapter();
  const eventBus = new InMemoryEventBus(logger);

  container = { logger, clock, uuidGenerator, eventBus };

  const sequelize = createSequelize(config.database.url, logger);
  await sequelize.authenticate();
  logger.info('Database connection established');

  initReviewedPRModel(sequelize);
  initRepositoryModel(sequelize);
  await Promise.all([
    ReviewedPRModel.sync(),
    RepositoryModel.sync(),
  ]);
  logger.info('Database tables ensured');

  const githubClient = new OctokitGitHubClient(config.github.pat, logger, clock);
  const repositoryRepository = new SequelizeRepositoryRepository(logger);

  if (config.scheduler.repositories.length === 0) {
    logger.info('REPOSITORIES not configured — syncing from GitHub');
    const githubRepos = await githubClient.listCollaboratorRepositories(config.github.username);
    await repositoryRepository.syncFromGitHub(githubRepos);
    logger.info(`Synced ${githubRepos.length} repositories from GitHub`);
  }
  const aiProvider = createAIProvider(config.ai, logger);
  const reviewRepository = new SequelizeReviewRepository(logger);

  const reviewPipeline = createReviewPipeline({
    githubClient,
    aiProvider,
    reviewRepository,
    eventBus,
    approvalThreshold: config.ai.approvalThreshold,
    logger,
    clock,
  });

  await reviewPipeline.subscribe(eventBus);
  logger.info('Review pipeline subscribed to events');

  scheduler = createScheduler({
    githubClient,
    eventBus,
    reviewRepository,
    repositoryRepository,
    repositories: config.scheduler.repositories,
    username: config.github.username,
    pollIntervalSeconds: config.scheduler.pollIntervalSeconds,
    concurrencyLimit: config.scheduler.concurrencyLimit,
    staggerDelaySeconds: config.scheduler.staggerDelaySeconds,
    cooldownMinutes: config.scheduler.cooldownMinutes,
    logger,
    clock,
    uuidGenerator,
  });

  scheduler.start();
  logger.info('Scheduler started');

  const app = createExpressApp(logger);

  const healthChecker = createHealthChecker({
    githubClient,
    aiProvider,
    logger,
    clock,
  });

  app.get('/health', async (_req, res) => {
    try {
      const report = await healthChecker();
      res.json({
        status: report.status,
        uptime: process.uptime(),
        timestamp: report.timestamp,
        checks: report.checks,
      });
    } catch (error) {
      logger.error('Health check crashed', {
        module: 'health',
        error: error instanceof Error ? error.message : String(error),
      });
      res.json({
        status: 'unhealthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  app.get('/', (_req, res) => {
    res.json({
      name: 'AI GitHub Reviewer',
      version: '1.0.0',
      status: 'running',
      llmProvider: config.ai.provider,
      pollIntervalSeconds: config.scheduler.pollIntervalSeconds,
      monitoredRepositories: config.scheduler.repositories.length,
    });
  });

  app.use(errorHandler);

  app.listen(config.port, () => {
    logger.info(`Server listening on port ${config.port}`);
  });

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    scheduler.stop();
    await sequelize.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    scheduler.stop();
    await sequelize.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
