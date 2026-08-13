# AI GitHub Reviewer

AI-powered code reviewer that automatically reviews GitHub pull requests using configurable LLM providers. Uses polling (PAT-based) instead of webhooks due to organizational restrictions.

- **Architecture:** Event-driven, Hexagonal (Ports & Adapters), Clean Architecture
- **Language:** TypeScript (Node.js)
- **Database:** PostgreSQL with Sequelize ORM
- **Framework:** Express.js (minimal, only for HTTP endpoints)

## Prerequisites

- Docker & Docker Compose
- GitHub Personal Access Token with `repo` scope
- (Optional) Node.js 18+ for local development

## Quick Start (Linux)

### 1. Clone and configure

```bash
git clone <repo-url> && cd ai-reviewer
cp .env.example .env
```

Edit `.env` with your tokens:

| Variable | Required | Description |
|---|---|---|
| `GITHUB_PAT` | Yes | GitHub Personal Access Token (`repo` scope) |
| `GITHUB_USERNAME` | Yes | Your GitHub username |
| `GROQ_API_KEY` | For Groq | Groq API key (free tier available) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |

### 2. Start with Docker

```bash
docker compose up -d
```

### 3. Check logs

```bash
docker compose logs -f ai-reviewer
```

The app will discover all your repositories and start polling for PR review requests.

## Configuration

All configuration via environment variables in `.env`:

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_PAT` | Yes | - | GitHub Personal Access Token |
| `GITHUB_USERNAME` | Yes | - | GitHub username to monitor |
| `LLM_PROVIDER` | No | `groq` | `minimax`, `groq`, or `openai` |
| `GROQ_API_KEY` | For Groq | - | Groq API key |
| `MINIMAX_API_KEY` | For Minimax | - | MiniMax API key |
| `OPENAI_API_KEY` | For OpenAI | - | OpenAI API key |
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `POLL_INTERVAL` | No | `60` | Polling interval in seconds (1-3600) |
| `APPROVAL_THRESHOLD` | No | `80` | Score threshold for approval (0-100) |
| `REPOSITORIES` | No | - | Comma-separated list of repos to monitor (`owner/repo`) |
| `PORT` | No | `5999` | HTTP server port |
| `CONCURRENCY_LIMIT` | No | `2` | Max PRs reviewed simultaneously (1-10) |
| `STAGGER_DELAY_SECONDS` | No | `10` | Delay between review batches (0-300s) |
| `COOLDOWN_MINUTES` | No | `10` | Skip re-review if same PR reviewed within N minutes (0-1440) |
| `MAX_PROMPT_TOKENS` | No | `4500` | Max tokens for AI prompt (500-32000) |
| `MAX_RESPONSE_TOKENS` | No | `1000` | Max tokens for AI response (100-4000) |
| `MAX_PATCH_CHARS_PER_FILE` | No | `1500` | Max characters per file patch (200-20000) |
| `NODE_ENV` | No | `development` | Environment |

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

**1. Create the service file:**

```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/ai-reviewer.service << 'EOF'
[Unit]
Description=AI GitHub Reviewer
After=docker.service

[Service]
WorkingDirectory=%h/Documents/ai-reviewer
ExecStart=/usr/bin/docker compose up
ExecStop=/usr/bin/docker compose down
Restart=on-failure

[Install]
WantedBy=default.target
EOF
```

**2. Enable and start:**

```bash
systemctl --user daemon-reload
systemctl --user enable ai-reviewer   # auto-start on login
systemctl --user start ai-reviewer    # start now
```

**3. Check status and logs:**

```bash
systemctl --user status ai-reviewer
journalctl --user -u ai-reviewer -f
```

**4. Stop and disable:**

```bash
systemctl --user stop ai-reviewer     # stop now
systemctl --user disable ai-reviewer  # remove auto-start
```

## Database

### Connection Details (DBeaver / psql)

| Field | Value |
|---|---|
| Host | `localhost` |
| Port | `5431` |
| Database | `ai_reviewer` |
| Username | `postgres` |
| Password | `postgres` |

### Managing Repositories

When `REPOSITORIES` env var is empty, the app discovers all your GitHub repos on startup and syncs them to the `repositories` table. Each repo has an `is_poll_check` column (default `true`).

To skip polling a specific repository, toggle it via SQL:

```sql
UPDATE repositories SET is_poll_check = false WHERE name = 'archived-project';
```

Changes take effect on the next poll cycle (no restart needed).

To re-enable:

```sql
UPDATE repositories SET is_poll_check = true WHERE name = 'archived-project';
```

### Force Re-review of a PR

```sql
DELETE FROM reviewed_prs WHERE repository = 'owner/repo' AND pr_number = 123;
```

### Re-review Prevention

The app uses a multi-layered approach to prevent unnecessary re-reviews:

| Layer | What it blocks | Resets when |
|---|---|---|
| **SHA dedup** | Same commit re-reviewed | New commit pushed |
| **`processedPRs` set** (in-memory) | Push-spam without reviewer remove/re-add | Reviewer removed then re-added, or SHA changes |
| **Cooldown** (`COOLDOWN_MINUTES`) | Re-reviews within N minutes | N minutes elapsed |
| **DB seed** (on restart) | Already-reviewed PRs re-processed | PR record deleted from `reviewed_prs` |

**Behavior summary:**

| Scenario | Review? | Why |
|---|---|---|
| First time added as reviewer | ✅ | PR not in `processedPRs` |
| Author pushes commits (no re-request) | ❌ | PR stays in results → `processedPRs` blocks it |
| Reviewer removed → re-added | ✅ | PR disappears from results → `processedPRs` entry deleted |
| Re-request button + push | ✅ (once per cooldown) | SHA changes → passes `processedPRs`; cooldown limits frequency |
| Long-running PR with daily pushes | ✅ (once per cooldown) | Only new SHA + cooldown expired triggers review |

### Manual Override (Force Re-review)

If you need to bypass the prevention layers and force a re-review:

**Same SHA (no new commits):**
```sql
DELETE FROM reviewed_prs WHERE repository = 'owner/repo' AND pr_number = 123;
```
Then **restart** the app to clear the in-memory `processedPRs` set:
```bash
make restart
# or
systemctl --user restart ai-reviewer
```

**Without restart (same SHA):**
Remove yourself as reviewer → wait one poll cycle → re-add yourself. The PR disappears then reappears → `processedPRs` entry is cleaned up → triggers a re-review.

**Different SHA (new commit):**
```sql
DELETE FROM reviewed_prs WHERE repository = 'owner/repo' AND pr_number = 123;
```
No restart needed — the new SHA passes the `processedPRs` check automatically.

## Architecture Overview

```
Scheduler ──► Event Bus ──► Review Pipeline
   │                            │
   ▼                            ▼
GitHub API                  AI Provider
   │                            │
   ▼                            ▼
Database                   GitHub (post review)
```

- **Scheduler:** Polls GitHub for PRs where you're a requested reviewer, publishes `ReviewRequested` events
- **Event Bus:** In-memory pub/sub (swappable with Kafka/RabbitMQ)
- **Review Pipeline:** Fetches diff → filters files → builds prompt → calls AI → posts review → persists result
- **Concurrency:** PRs are processed in parallel batches (configurable) with stagger delays for rate limit safety

See [AGENTS.md](AGENTS.md) for full architecture and development documentation.

## Development

```bash
npm install          # Install dependencies
npm run dev          # Run with ts-node
npm test             # Run tests
npm run test:coverage # Run with coverage
npx tsc --noEmit     # Type-check
npm run build        # Compile to dist/
```

## Troubleshooting

### Rate Limit Errors
- GitHub API: 5000 requests/hour. Reduce `POLL_INTERVAL` if hitting limits.
- The client has built-in retry with exponential backoff.
- 45 repos at 60s interval uses ~2,700 calls/hr (safe).

### AI Provider Errors
- Check API key is correct.
- Check rate limits (Groq free: 30 RPM, 6K TPM).
- Large PRs may hit TPM limits — handled by automatic retry with truncation.

### Database Connection Issues
- Ensure PostgreSQL is running: `docker compose ps postgres`
- Verify `DATABASE_URL` is correct.
- Check Docker network.

### "No handlers subscribed" Warning
- The `ReviewPipeline` subscription may have failed.
- Check startup logs for errors.
