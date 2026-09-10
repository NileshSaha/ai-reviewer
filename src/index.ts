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
import { ReviewRequestedEvent, EVENT_TYPES } from './modules/events/application/types';
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

  // Safe schema migration for the new provider column
  await sequelize.query('ALTER TABLE reviewed_prs ADD COLUMN IF NOT EXISTS provider VARCHAR(100)').catch((err) => {
    logger.warn('Failed to ensure provider column exists (it might already exist or table is not created yet)', { error: err.message });
  });

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
    skipReviewBelowScore: config.ai.skipReviewBelowScore,
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

  // Swagger specification JSON
  app.get('/swagger.json', (_req, res) => {
    res.json({
      openapi: '3.0.0',
      info: {
        title: 'AI GitHub Reviewer API',
        version: '1.0.0',
        description: 'Interactive API console for triggering manual PR reviews and checking service health.',
      },
      paths: {
        '/review': {
          post: {
            summary: 'Manually trigger a pull request review',
            description: 'Triggers a review for the specified GitHub Pull Request URL. Bypasses cooldowns and polling delays but skips if the commit SHA is already reviewed.',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      prUrl: {
                        type: 'string',
                        example: 'https://github.com/owner/repo/pull/123',
                        description: 'The full URL of the GitHub pull request to review',
                      },
                    },
                    required: ['prUrl'],
                  },
                },
              },
            },
            responses: {
              200: {
                description: 'Review triggered or skipped successfully',
              },
              400: {
                description: 'Invalid input or PR URL format',
              },
            },
          },
        },
        '/health': {
          get: {
            summary: 'Get service health status',
            responses: {
              200: {
                description: 'Health status report',
              },
            },
          },
        },
        '/': {
          get: {
            summary: 'Get service metadata',
            responses: {
              200: {
                description: 'Service metadata',
              },
            },
          },
        },
      },
    });
  });

  // Swagger HTML Documentation UI Page
  app.get('/docs', (_req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>AI GitHub Reviewer API Docs</title>
        <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css">
        <style>
          html { box-sizing: border-box; overflow-y: scroll; }
          *, *:before, *:after { box-sizing: inherit; }
          body { margin: 0; background: #fafafa; }
        </style>
      </head>
      <body>
        <div id="swagger-ui"></div>
        <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
        <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js"></script>
        <script>
          window.onload = function() {
            const ui = SwaggerUIBundle({
              url: "/swagger.json",
              dom_id: '#swagger-ui',
              deepLinking: true,
              presets: [
                SwaggerUIBundle.presets.apis,
                SwaggerUIStandalonePreset
              ],
              plugins: [
                SwaggerUIBundle.plugins.DownloadUrl
              ],
              layout: "StandaloneLayout"
            });
            window.ui = ui;
          };
        </script>
      </body>
      </html>
    `);
  });

  app.post('/review', async (req, res, next) => {
    try {
      const { prUrl } = req.body;
      if (!prUrl || typeof prUrl !== 'string') {
        res.status(400).json({ error: 'Missing or invalid prUrl' });
        return;
      }

      const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
      if (!match) {
        res.status(400).json({ error: 'Invalid GitHub Pull Request URL format' });
        return;
      }

      const owner = match[1];
      const repo = match[2];
      const prNumber = parseInt(match[3], 10);
      const repository = `${owner}/${repo}`;

      logger.info(`Manual review trigger requested for PR: ${prUrl} (${repository}#${prNumber})`);

      const prDetails = await githubClient.getPullRequest(owner, repo, prNumber);

      // Check if this head SHA has already been reviewed
      const alreadyReviewed = await reviewRepository.hasBeenReviewedWithSameSHA(
        repository,
        prNumber,
        prDetails.headSha
      );

      if (alreadyReviewed) {
        logger.info(`PR ${repository}#${prNumber} has already been reviewed with latest SHA ${prDetails.headSha}. Skipping.`);
        res.json({
          message: `PR ${repository}#${prNumber} is already reviewed with the latest commit SHA (${prDetails.headSha}). No review triggered.`,
          headSha: prDetails.headSha,
        });
        return;
      }

      const correlationId = uuidGenerator.generateV4();

      const event: ReviewRequestedEvent = {
        type: EVENT_TYPES.REVIEW_REQUESTED,
        payload: {
          correlationId,
          repository,
          prNumber,
          prTitle: prDetails.title,
          prBody: prDetails.body,
          author: prDetails.author.login,
          baseBranch: prDetails.baseBranch,
          headBranch: prDetails.headBranch,
          headSha: prDetails.headSha,
          requestedAt: clock.nowISO(),
        },
      };

      await eventBus.publish(event);

      res.json({
        message: `Review triggered successfully for ${repository}#${prNumber}`,
        correlationId,
        headSha: prDetails.headSha,
      });
    } catch (err: any) {
      next(err);
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
