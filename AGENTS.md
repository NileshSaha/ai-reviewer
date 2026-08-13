# AI GitHub Reviewer - Agent Documentation

## Project Overview

AI-powered code reviewer that automatically reviews GitHub pull requests using configurable LLM providers. Uses polling (PAT-based) instead of webhooks due to organizational restrictions.

**Architecture:** Event-driven, Hexagonal (Ports & Adapters), Clean Architecture
**Language:** TypeScript (Node.js)
**Database:** PostgreSQL with Sequelize ORM
**Framework:** Express.js (minimal, only for HTTP endpoints)

---

## Architecture Principles

1. **Event-Driven:** Scheduler only publishes events; never calls review logic directly
2. **Hexagonal:** All external dependencies behind interfaces (ports)
3. **Functional where possible:** Prefer functions over classes except where required
4. **Dependency Injection:** All dependencies injected, never imported directly
5. **Loose Coupling:** Event Bus allows swapping any component without affecting others

---

## Project Structure

```
src/
├── config/                          # Environment configuration
│   ├── types.ts                     # Config interfaces
│   └── index.ts                     # loadConfig() function
│
├── shared/
│   ├── types/                      # Shared interfaces (ports)
│   │   ├── logger.ts               # Logger interface
│   │   ├── clock.ts                # Clock interface
│   │   ├── uuid.ts                 # UUIDGenerator interface
│   │   └── errors.ts               # Custom error types
│   └── utils/                       # Shared utilities
│       ├── logger.ts               # StructuredLogger implementation
│       ├── clock.ts                # SystemClock implementation
│       └── uuid.ts                 # UUIDAdapter implementation
│
├── modules/
│   ├── events/                     # Event Bus module
│   │   ├── application/
│   │   │   ├── types.ts           # Domain event types
│   │   │   └── eventBus.ts        # EventBus interface
│   │   └── infrastructure/
│   │       └── inMemoryEventBus.ts # In-memory implementation
│   │
│   ├── github/                     # GitHub module
│   │   ├── domain/
│   │   │   └── githubEntities.ts  # GitHub domain entities
│   │   ├── application/
│   │   │   ├── githubClient.ts    # GitHubClient interface (port)
│   │   │   └── index.ts
│   │   └── infrastructure/
│   │       └── octokitGitHubClient.ts # Octokit adapter
│   │
│   ├── ai/                         # AI module
│   │   ├── application/
│   │   │   ├── aiTypes.ts         # AI types (AIReviewResult, PRDetails)
│   │   │   ├── aiProvider.ts      # AIProvider interface (port)
│   │   │   ├── promptBuilder.ts   # Review prompt construction
│   │   │   └── index.ts
│   │   └── infrastructure/
│   │       ├── baseAIProvider.ts  # Common AI logic
│   │       ├── minimaxAIProvider.ts
│   │       ├── groqAIProvider.ts
│   │       ├── openAIProvider.ts
│   │       └── aiFactory.ts        # Factory to create AI providers
│   │
│   ├── review/                     # Review module
│   │   ├── domain/
│   │   │   ├── reviewedPR.ts      # ReviewedPR entity
│   │   │   ├── scorer.ts          # Scoring logic (80% threshold)
│   │   │   └── fileFilter.ts      # File filtering (ignore binaries, locks)
│   │   ├── application/
│   │   │   ├── reviewRepository.ts # ReviewRepository interface (port)
│   │   │   ├── reviewPipeline.ts   # Review orchestration pipeline
│   │   │   └── index.ts
│   │   └── infrastructure/
│   │       └── sequelizeReviewRepository.ts # PostgreSQL adapter
│   │
│   └── scheduler/                  # Scheduler module
│       └── application/
│           └── schedulerService.ts # Polls GitHub, publishes events
│
├── database/
│   ├── sequelize.ts               # Sequelize instance management
│   └── models/
│       ├── index.ts
│       └── reviewedPR.ts          # Sequelize model for reviewed_prs
│
├── bootstrap/
│   └── express.ts                  # Express app setup
│
└── index.ts                        # Entry point (DI wiring)
```

---

## Event Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Scheduler                                 │
│  - Runs every POLL_INTERVAL seconds                             │
│  - Fetches PRs where user is requested reviewer                 │
│  - Checks if PR already reviewed (by headSha)                   │
│  - Publishes ReviewRequested event                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ ReviewRequested Event
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Event Bus                                │
│  - In-memory implementation                                     │
│  - publish(event) → all subscribers notified                     │
│  - Swappable with Kafka/RabbitMQ/Redis Streams                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Review Pipeline                             │
│  1. Fetch PR details from GitHub                                │
│  2. Fetch changed files                                         │
│  3. Filter files (ignore binaries, locks, dist, etc.)           │
│  4. Build review prompt                                         │
│  5. Call AI provider (Minimax/Groq/OpenAI)                      │
│  6. Parse AI response                                           │
│  7. Decide (APPROVE if score >= 80, else REQUEST_CHANGES)      │
│  8. Post review to GitHub                                       │
│  9. Persist review state                                       │
│  10. Publish ReviewCompleted/Failed event                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Domain Events

```typescript
// ReviewRequestedEvent - Published by Scheduler
{
  type: 'ReviewRequested',
  payload: {
    correlationId: string,
    repository: string,       // "owner/repo"
    prNumber: number,
    prTitle: string,
    prBody: string | null,
    author: string,
    baseBranch: string,
    headBranch: string,
    headSha: string,
    requestedAt: string
  }
}

// ReviewCompletedEvent - Published by Review Pipeline
{
  type: 'ReviewCompleted',
  payload: {
    correlationId: string,
    repository: string,
    prNumber: number,
    decision: 'APPROVE' | 'REQUEST_CHANGES',
    score: number,
    commentsCount: number,
    completedAt: string
  }
}

// ReviewFailedEvent - Published by Review Pipeline
{
  type: 'ReviewFailed',
  payload: {
    correlationId: string,
    repository: string,
    prNumber: number,
    error: string,
    failedAt: string
  }
}
```

---

## Ports (Interfaces)

All external dependencies are abstracted behind interfaces:

| Port | Purpose | Implementation |
|------|---------|----------------|
| `Logger` | Structured logging | `StructuredLogger` |
| `Clock` | Time access | `SystemClock` |
| `UUIDGenerator` | ID generation | `UUIDAdapter` |
| `EventBus` | Event publishing | `InMemoryEventBus` |
| `GitHubClient` | GitHub API | `OctokitGitHubClient` |
| `AIProvider` | AI inference | `MinimaxAIProvider`, `GroqAIProvider`, `OpenAIProvider` |
| `ReviewRepository` | Review persistence | `SequelizeReviewRepository` |

---

## AI Providers

Three AI providers supported via adapter pattern:

### Minimax
- Endpoint: `https://api.minimax.chat/v1/chat/completions`
- Model: `MiniMax-Text-01`
- Auth: Bearer token

### Groq (Recommended - Free Tier)
- Endpoint: `https://api.groq.com/openai/v1/chat/completions`
- Model: `llama-3.1-8b-instant`
- Auth: Bearer token
- Free tier available

### OpenAI
- Endpoint: `https://api.openai.com/v1/chat/completions`
- Model: `gpt-4o-mini` (configurable)
- Auth: Bearer token

---

## File Filtering

The `FileFilter` ignores the following:

| Pattern | Examples |
|---------|----------|
| Lock files | `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` |
| Binary files | `*.png`, `*.jpg`, `*.pdf`, `*.zip` |
| Build output | `dist/`, `build/`, `out/`, `target/` |
| Dependencies | `node_modules/`, `vendor/`, `bower_components/` |
| Generated | `*.pyc`, `*.class`, `*.o` |
| Hidden files | `.*` (except `.gitignore`) |

---

## Configuration

All configuration via environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_PAT` | Yes | - | GitHub Personal Access Token |
| `GITHUB_USERNAME` | Yes | - | GitHub username to monitor |
| `LLM_PROVIDER` | Yes | `groq` | `minimax`, `groq`, or `openai` |
| `GROQ_API_KEY` | For Groq | - | Groq API key |
| `MINIMAX_API_KEY` | For Minimax | - | MiniMax API key |
| `OPENAI_API_KEY` | For OpenAI | - | OpenAI API key |
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `POLL_INTERVAL` | No | `60` | Polling interval in seconds (1-3600) |
| `APPROVAL_THRESHOLD` | No | `80` | Score threshold for approval (0-100) |
| `REPOSITORIES` | No | - | List of repos to monitor (one per line, format: `owner/repo`) |
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | Environment |

---

## Database Schema

### reviewed_prs Table

```sql
CREATE TABLE reviewed_prs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository VARCHAR(500) NOT NULL,
  pr_number INTEGER NOT NULL,
  head_sha VARCHAR(100) NOT NULL,
  reviewed_at TIMESTAMP NOT NULL,
  UNIQUE (repository, pr_number, head_sha)
);

CREATE INDEX idx_reviewed_prs_repo_pr ON reviewed_prs (repository, pr_number);
```

The `head_sha` is used to detect if a PR needs re-review after new commits.

---

## Adding a New AI Provider

1. Create adapter in `src/modules/ai/infrastructure/`:

```typescript
// src/modules/ai/infrastructure/newAIProvider.ts
import { BaseAIProvider } from './baseAIProvider';
import { Logger } from '../../../shared/types/logger';

export class NewAIProvider extends BaseAIProvider {
  protected nameValue = 'newai';
  protected endpoint = 'https://api.newai.com/v1/chat/completions';
  protected model = 'model-name';

  constructor(apiKey: string, logger: Logger) {
    super(apiKey, logger);
  }

  buildRequestBody(prompt: string): object {
    return {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
    };
  }

  parseResponse(response: any) {
    const content = response.choices?.[0]?.message?.content;
    return this.parseAIReviewResponse(content);
  }
}
```

2. Update `aiFactory.ts`:

```typescript
import { NewAIProvider } from './newAIProvider';

export function createAIProvider(config: AIConfig, logger: Logger): AIProvider {
  switch (config.provider) {
    case 'newai':
      return new NewAIProvider(config.newaiApiKey, logger);
    // ... other cases
  }
}
```

3. Add to config validation in `src/config/index.ts`:

```typescript
// Add to REPOSITORIES parsing
if (!['minimax', 'groq', 'openai', 'newai'].includes(llmProvider)) {
  throw new ValidationError(`Invalid LLM_PROVIDER: ${llmProvider}`);
}
```

---

## Adding Event Bus Implementation (e.g., Kafka)

1. Create `src/modules/events/infrastructure/kafkaEventBus.ts`:

```typescript
import { EventBus, EventHandler } from '../application/eventBus';
import { DomainEvent } from '../application/types';
import { Logger } from '../../../shared/types/logger';

export class KafkaEventBus implements EventBus {
  async publish<T extends DomainEvent>(event: T): Promise<void> {
    // Kafka publish logic
  }

  async subscribe<T extends DomainEvent>(
    eventType: string,
    handler: EventHandler<T>
  ): Promise<() => Promise<void>> {
    // Kafka subscribe logic
    return async () => { /* unsubscribe */ };
  }

  async unsubscribe(eventType: string): Promise<void> {
    // Kafka unsubscribe logic
  }

  async clearAll(): Promise<void> {
    // Clear all subscriptions
  }
}
```

2. Update `src/index.ts` to use `KafkaEventBus` instead of `InMemoryEventBus`.

---

## Testing

### Running Tests

```bash
npm test                    # Run all tests
npm run test:coverage       # Run with coverage
```

### Writing Tests

Tests should mock all external dependencies:

```typescript
// Example: Testing ReviewPipeline with mocks
const mockGitHubClient = {
  getPullRequest: jest.fn().mockResolvedValue(mockPR),
  getPullRequestFiles: jest.fn().mockResolvedValue(mockFiles),
  createReview: jest.fn().mockResolvedValue({ id: 1 }),
};

const mockAIProvider = {
  generateReview: jest.fn().mockResolvedValue({
    score: 85,
    summary: 'Good PR',
    comments: [],
  }),
  name: () => 'mock',
};

const mockEventBus = {
  publish: jest.fn(),
  subscribe: jest.fn().mockResolvedValue(jest.fn()),
};

const mockRepository = {
  create: jest.fn(),
  hasBeenReviewedWithSameSHA: jest.fn().mockResolvedValue(false),
};
```

---

## Common Tasks

### Force Re-review of a PR

Delete the corresponding row from `reviewed_prs` table:

```sql
DELETE FROM reviewed_prs WHERE repository = 'owner/repo' AND pr_number = 123;
```

### Change Approval Threshold

Set `APPROVAL_THRESHOLD=70` in environment or `.env` file.

### Monitor Multiple Repositories

Add to `REPOSITORIES` in `.env`:

```
owner/repo-one
owner/repo-two
owner/repo-three
```

---

## Docker Commands

```bash
# Start application
docker-compose up -d

# View logs
docker-compose logs -f ai-reviewer

# Stop application
docker-compose down

# Rebuild after code changes
docker-compose up -d --build
```

---

## Environment Examples

### Development
```bash
NODE_ENV=development
PORT=3000
GITHUB_PAT=ghp_xxxxxxxxxxxxx
GITHUB_USERNAME=myusername
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_xxxxxxxxxxxxx
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_reviewer
POLL_INTERVAL=60
APPROVAL_THRESHOLD=80
```

### Production (Docker)
```bash
NODE_ENV=production
PORT=3000
GITHUB_PAT=ghp_xxxxxxxxxxxxx
GITHUB_USERNAME=myusername
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_xxxxxxxxxxxxx
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ai_reviewer
POLL_INTERVAL=300
APPROVAL_THRESHOLD=80
```

---

## Troubleshooting

### "No handlers subscribed for event" Warning
- The `ReviewPipeline` subscription may have failed
- Check that `reviewPipeline.subscribe(eventBus)` is called in `index.ts`

### Rate Limit Errors
- GitHub API rate limit is 5000 requests/hour
- The `OctokitGitHubClient` has built-in retry with exponential backoff
- Reduce `POLL_INTERVAL` if hitting limits

### AI Provider Errors
- Check API key is correct
- Verify endpoint is accessible
- Check AI provider's rate limits

### Database Connection Issues
- Ensure PostgreSQL is running
- Verify `DATABASE_URL` is correct
- Check Docker network if using docker-compose

---

## Running the Application

### Docker Compose

```bash
docker compose up -d              # Start (background)
docker compose down               # Stop
docker compose logs -f ai-reviewer # Tail logs
```

### Makefile Shortcuts

```bash
make up       # docker compose up -d
make down     # docker compose down
make logs     # docker compose logs -f ai-reviewer
make logs_200 # docker compose logs --tail=200 -f ai-reviewer
make restart  # down && up
```

### Systemd User Service (Auto-start on Login)

Save as `~/.config/systemd/user/ai-reviewer.service`:

```ini
[Unit]
Description=AI GitHub Reviewer
After=docker.service

[Service]
WorkingDirectory=/home/cx060/Documents/ai-reviewer
ExecStart=/usr/bin/docker compose up
ExecStop=/usr/bin/docker compose down
Restart=on-failure

[Install]
WantedBy=default.target
```

Enable and manage:

```bash
systemctl --user daemon-reload
systemctl --user enable ai-reviewer   # auto-start on login
systemctl --user start ai-reviewer    # start now
systemctl --user stop ai-reviewer     # stop now
systemctl --user status ai-reviewer   # check status
journalctl --user -u ai-reviewer -f   # tail logs
```
