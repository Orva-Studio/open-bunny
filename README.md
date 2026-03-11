# 🐇 OpenBunny

Self-hostable AI PR review platform — open-source alternative to CodeRabbit.

OpenBunny connects to your GitHub repositories via a GitHub App and automatically reviews pull requests using AI. It runs linters, security scanners, and builds rich context before calling the AI, so reviews are grounded in actual code quality signals.

## Features

- **Automatic PR reviews** — triggered on `opened`, `synchronize`, and `reopened` events
- **Multi-provider AI** — OpenAI, Anthropic, Google, any OpenAI-compatible API, or Ollama
- **Static analysis** — ESLint, Ruff, ShellCheck, Semgrep, Gitleaks, Trivy
- **Smart context** — finds callers, callees, and related tests before asking the AI
- **Chat commands** — `@openbunny review`, `pause`, `resume`, `ignore`, `help`
- **Setup wizard** — one-click GitHub App creation, zero manual credential setup
- **Self-hosted** — your code never leaves your infrastructure

## Quick Start (Self-Hosted)

### 1. Configure environment

```bash
cp .env.example .env
# Required: set BASE_URL and ENCRYPTION_KEY
# Generate ENCRYPTION_KEY with: openssl rand -hex 32
```

### 2. Start OpenBunny

```bash
docker-compose up -d
```

### 3. Open the dashboard

Visit http://localhost:3001 and follow the setup wizard:

1. **Create admin account** — set your email and password
2. **Connect GitHub** — one-click App creation via GitHub App Manifest flow
3. **Select repositories** — install the App on repos you want reviewed

That's it — OpenBunny will start reviewing PRs automatically.

## Architecture

```
GitHub webhook
      │
  Hono API (port 3000)
      │
  BullMQ + Redis
      │
  Worker
    ├── Fetch diff (Octokit)
    ├── Clone repo
    ├── Run linters (ESLint / Ruff / ShellCheck)
    ├── Run security (Semgrep / Gitleaks / Trivy)
    ├── Gather context (callers / callees / tests)
    └── Call AI → post review comments
      │
  React UI (port 3001)
```

**Tech stack:** Bun · TypeScript · Hono · React + Vite · Prisma · PostgreSQL · Redis · BullMQ · Octokit · Vercel AI SDK · Better Auth

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `BASE_URL` | ✅ | Public URL of the API (e.g. `https://openbunny.example.com`) |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string |
| `ENCRYPTION_KEY` | ✅ | 32-byte hex key for AES-256-GCM (`openssl rand -hex 32`) |
| `POSTGRES_PASSWORD` | docker | Password for the bundled Postgres container |
| `PORT` | | API port (default: `3000`) |
| `LOG_LEVEL` | | `debug`/`info`/`warn`/`error` (default: `info`) |

GitHub App credentials and AI API keys are stored encrypted in the database after the setup wizard — no manual env var configuration needed.

## Development

```bash
# Install dependencies
bun install

# Start all services (requires Docker)
docker-compose up -d postgres redis

# Run API in watch mode
bun run dev:api

# Run worker in watch mode
bun run dev:worker

# Run UI dev server (proxies /api to :3000)
bun run dev:ui

# Run unit tests
bun test

# Run E2E tests (requires running stack)
bun run test:e2e
```

## License

[Functional Source License 1.0, Apache 2.0 Future License](LICENSE) — free to self-host, source-available, converts to Apache 2.0 after 4 years.
