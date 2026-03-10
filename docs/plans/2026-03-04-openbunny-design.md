# OpenBunny Design Document

**Date:** 2026-03-04
**Status:** Approved
**License:** FSL-1.0-Apache-2.0

---

## Overview

OpenBunny is an open-source AI-powered PR review platform — a maintained, self-hostable alternative to CodeRabbit Pro. It receives GitHub webhooks, enriches PR diffs with smart context retrieval, runs linter and security tools, calls a user-configured AI model, and posts structured review comments back to GitHub.

**Key positioning:**
- Source-available (FSL 1.0) — fork-friendly, prevents competing cloud clones
- Self-hostable via Docker Compose (bring your own AI API keys)
- Paid managed cloud version (per-seat, $15–20/contributing dev/month)
- Based on the archived `coderabbitai/ai-pr-reviewer` OSS project

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        OpenBunny                            │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  API Server  │    │   Worker(s)  │    │   Web UI     │  │
│  │  (Hono/Bun)  │───▶│  (BullMQ)   │    │  (React+Vite)│  │
│  │              │    │              │    │              │  │
│  │ - Webhooks   │    │ - Review job │    │ - Dashboard  │  │
│  │ - Auth       │    │ - Linter job │    │ - Config     │  │
│  │ - REST API   │    │ - AI gateway │    │ - Analytics  │  │
│  └──────┬───────┘    └──────┬───────┘    └──────────────┘  │
│         │                  │                                │
│  ┌──────▼──────────────────▼──────┐                        │
│  │         PostgreSQL + Redis      │                        │
│  │  (state, jobs, learnings cache) │                        │
│  └────────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
   GitHub Webhooks      GitHub API
   (PR events)          (post comments)
```

### Architecture Pattern

**Modular Monolith with Worker Separation**

- `apps/api` — Hono server: receives webhooks, validates signatures, enqueues jobs, serves REST API and web UI assets
- `apps/worker` — BullMQ worker: processes async review jobs (AI calls, linters, security scanners). Horizontally scalable via `docker-compose up --scale worker=N`
- `apps/ui` — React + Vite SPA: dashboard for config, review history, analytics

**Queue:** BullMQ on Redis (Redis already required for caching; no extra service needed vs. RabbitMQ). Built-in UI via Bull Board. Job retry with exponential backoff.

### Data Flow (PR Review)

1. PR opened/updated → GitHub sends webhook to API server
2. API server validates HMAC signature, enqueues `review` job in BullMQ, returns `200 OK` immediately
3. Worker picks up job:
   - Fetches PR diff via GitHub API
   - Fetches repo snapshot for context retrieval (GitHub Search API or shallow clone)
   - Embeds changed functions → finds callers/callees via semantic search
   - Runs configured linters (sandboxed subprocesses)
   - Runs security scanners (Semgrep, Gitleaks, Trivy)
   - Constructs enriched prompt → calls AI model (multi-provider)
   - AI synthesizes linter + security output, filters noise
4. Posts PR summary comment + inline review comments to GitHub
5. Stores review state in Postgres (for incremental reviews)

### Self-Hosting

```yaml
# docker-compose.yml
services:
  api:       # Hono server, port 3000
  worker:    # BullMQ worker (scale: docker-compose up --scale worker=3)
  ui:        # React + Vite, port 3001
  postgres:  # State, config, review history
  redis:     # Job queue + cache
```

**Minimal env vars required to boot:**

```env
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
BASE_URL=http://localhost:3000   # public URL of the API (used for webhook + OAuth callbacks)
ENCRYPTION_KEY=<32-byte hex>     # for encrypting secrets at rest
```

GitHub App credentials and AI API keys are configured through the UI after first boot — no manual copy-pasting of private keys.

### First-Run Setup Wizard

On first boot, the UI detects `setup_complete = false` and walks the user through three steps:

**Step 1 — Create admin account**
Set an email + password for the OpenBunny dashboard. Stored via Better Auth (bcrypt-hashed).

**Step 2 — Connect GitHub (App Manifest flow)**
OpenBunny submits a pre-filled GitHub App manifest to `https://github.com/settings/apps/new`. GitHub shows a one-click confirmation page. On approval:
- GitHub redirects to `{BASE_URL}/api/github/manifest-callback?code=...`
- OpenBunny exchanges the code for App ID, private key, webhook secret, client credentials
- All credentials stored AES-256 encrypted in the `app_config` table — no env vars needed

**Step 3 — Install on repositories**
A "Install on repositories" button links to `https://github.com/apps/{app-slug}/installations/new`. The user selects repos on GitHub's UI. On completion:
- GitHub sends `installation.created` webhook + redirects to `{BASE_URL}/api/github/install-callback`
- Repos are stored in DB with status `disabled` (user must explicitly enable them)
- User is redirected to the Repos page to enable the repos they want reviewed

Total time from `docker compose up` to first review: ~5 minutes.

---

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Bun |
| API Framework | Hono |
| Frontend | React + Vite |
| ORM | Prisma + PostgreSQL |
| Queue | BullMQ (Redis) |
| GitHub SDK | Octokit + GitHub App Manifest API |
| Auth | Better Auth (credentials provider, Hono adapter) |
| AI Providers | Vercel AI SDK (`ai` + provider packages) — unified interface across all providers |
| Unit/Integration Testing | Bun test |
| E2E Testing | Playwright |
| Containerization | Docker Compose |

---

## Repository Structure

```
openbunny/
├── src/
│   ├── api/              # Hono server (webhooks, REST API, auth, setup routes)
│   ├── worker/           # BullMQ worker (review jobs, linter/security runners)
│   └── lib/              # shared utilities
│       ├── config.ts     # .openbunny.json/.yaml parser (Zod)
│       ├── crypto.ts     # AES-256-GCM encrypt/decrypt
│       ├── db.ts         # Prisma client singleton
│       ├── ai.ts         # Vercel AI SDK gateway
│       ├── github.ts     # Octokit wrapper, webhook validation
│       ├── linters/      # ESLint, Ruff, ShellCheck, etc.
│       ├── security/     # Semgrep, Gitleaks, Trivy
│       └── context/      # Smart context retrieval (embeddings + code search)
├── prisma/
│   └── schema.prisma
├── apps/
│   ├── ui/               # React + Vite dashboard (own package.json)
│   └── e2e/              # Playwright E2E tests (own package.json)
├── package.json
├── tsconfig.json
├── docker-compose.yml
└── .env.example
```

---

## Configuration

Supported file names (in priority order — JSON takes precedence):
1. `.openbunny.json`
2. `.openbunny.yaml` / `.openbunny.yml`

Both formats parsed with the same Zod schema. On validation error, post a helpful config error comment on the PR; never crash silently.

### Config Schema

```yaml
ai:
  provider: anthropic          # openai | anthropic | google | openai-compatible | ollama
  model: claude-sonnet-4-6
  light_model: claude-haiku-4-5  # cheaper model for summaries
  base_url: ""                  # required for openai-compatible (e.g. Qwen, Baidu ERNIE, vLLM, LM Studio)
                                 # also used by ollama (default: http://localhost:11434/v1)

reviews:
  profile: chill               # chill | assertive
  path_filters:
    - "!**/*.lock"
    - "!dist/**"
  path_instructions:
    - path: "**/*.ts"
      instructions: "Enforce strict null checks"
  auto_review:
    enabled: true
    labels: []                 # only review PRs with these labels
    draft: false               # review draft PRs?
  skip_trivial: true           # skip whitespace-only changes

linters:
  eslint: { enabled: true }
  ruff: { enabled: true }
  shellcheck: { enabled: true }
  biome: { enabled: false }
  pylint: { enabled: false }
  stylelint: { enabled: false }
  hadolint: { enabled: true }   # Dockerfile linting
  markdownlint: { enabled: false }
  checkov: { enabled: false }   # IaC scanning
  actionlint: { enabled: true } # GitHub Actions linting

security:
  semgrep: { enabled: true }
  gitleaks: { enabled: true }   # secret detection
  trivy: { enabled: true }      # dependency/container vulns
  owasp_review: true            # LLM-based OWASP Top 10 check
```

---

## Features (v1 MVP)

### Core Review Engine

| Feature | Description |
|---|---|
| PR Summary | High-level paragraph summarizing purpose and scope |
| Walkthrough | Per-file breakdown of what changed and why |
| Line-by-line comments | Inline diff comments with severity: Critical / Major / Minor / Nitpick |
| Code suggestions | GitHub suggestion format (one-click apply in GitHub UI) |
| Incremental reviews | Track last-reviewed commit SHA; re-review only new changes on push |
| Full review on demand | `@openbunny review` resets state and triggers full re-review |
| Smart skip | Skip trivial changes (whitespace, lock bumps) unless configured otherwise |
| Smart context retrieval | Embed changed functions, retrieve callers/callees from repo for richer context |

### Chat Commands

| Command | Effect |
|---|---|
| `@openbunny review` | Trigger full review |
| `@openbunny pause` | Pause auto-reviews for this PR |
| `@openbunny resume` | Resume auto-reviews |
| `@openbunny ignore` | Ignore this PR entirely |
| `@openbunny config` | Print current effective config as JSON |
| `@openbunny help` | Print command list |
| Free-form question | AI responds with codebase/PR context |

### Linter Integrations (v1)

ESLint, Ruff, Pylint, ShellCheck, Biome, Stylelint, Hadolint (Dockerfiles), markdownlint, Checkov (IaC), ActionLint (GitHub Actions)

Linters run as sandboxed subprocesses inside the worker. Output is filtered through the AI to reduce noise before posting.

### Security Integrations (v1)

- **Semgrep** — SAST (cross-language)
- **Gitleaks** — secret/credential detection
- **Trivy** — dependency vulnerabilities + container scanning
- **OWASP LLM scan** — AI-driven OWASP Top 10 review (injection, XSS, CSRF, insecure design, etc.)

All security findings include severity, affected lines, and recommended remediation.

### Multi-Provider AI

Built on the **Vercel AI SDK** (`ai` package) with per-provider adapter packages. The SDK provides a single `generateText()` call regardless of provider, with consistent error handling and TypeScript types.

**First-party provider packages (install as needed):**
- `@ai-sdk/anthropic` — Anthropic Claude (3.x / 4.x)
- `@ai-sdk/openai` — OpenAI (GPT-4o, GPT-4o-mini, o-series)
- `@ai-sdk/google` — Google Gemini (2.0 Flash, 2.5 Pro)
- `@ai-sdk/openai-compatible` — any OpenAI-compatible endpoint via `base_url`

**Models via `openai-compatible`:**
- DeepSeek (V3, R1): `baseURL: "https://api.deepseek.com/v1"`
- Qwen / Qwen3 (Alibaba DashScope): `baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"`
- Baidu ERNIE: via OpenAI-compatible endpoint or aggregator
- Moonshot Kimi: via OpenAI-compatible endpoint
- Any aggregator (OpenRouter, aihubmix): single API key, 500+ models

**Local models:**
- Ollama: community provider `ollama-ai-provider` or `ai-sdk-ollama`
- vLLM / LM Studio: `openai-compatible` provider with local `base_url`

Two-model strategy: `light_model` for summaries/walkthroughs (cheap), `model` for detailed review (capable).

> **Bun note:** `generateText` (used by OpenBunny) works correctly in Bun. The known Bun production bug only affects `streamText`, which OpenBunny does not use.

---

## Data Model

### Core Tables

| Table | Purpose |
|---|---|
| `app_config` | Singleton row: GitHub App credentials (encrypted), OpenAI key, setup state |
| `installations` | GitHub App installs (org/repo → access token) |
| `repositories` | Enrolled repos + enabled/disabled flag + cached config |
| `pull_requests` | PR state: last reviewed commit SHA, review status |
| `reviews` | One record per completed review run |
| `review_comments` | Individual inline + summary comments posted |
| `jobs` | BullMQ job audit log (for debugging, retries) |
| `users` | Web UI admin accounts (Better Auth) |

### Key Relationships

```
installation  → many repositories
repository    → many pull_requests
pull_request  → many reviews  (incremental = one per push)
review        → many review_comments
```

### Incremental Review State

`pull_requests.last_reviewed_commit_sha` tracks the last commit reviewed. On each push, the worker diffs `last_reviewed_commit_sha`..`HEAD`, reviews only that delta, then updates the SHA. `@openbunny review` resets the SHA to `null` to force a full re-review.

---

## Error Handling

| Scenario | Handling |
|---|---|
| AI call failure / timeout | Retry with exponential backoff (3 attempts: 1s/5s/30s). On max retries, post error comment on PR. |
| Linter crash / not installed | Log error, skip linter's output, continue with rest of review. Never fail entire review. |
| GitHub API rate limit | Check `X-RateLimit-Remaining` header; use BullMQ `delay` to schedule job after reset time. |
| Invalid config file | Post config error comment with line/field details. Fall back to defaults for non-critical fields. |
| Webhook signature mismatch | Reject with `403`, log, no job enqueued. |
| PR from fork | Fork PRs have no write access to secrets. Post review as read-only comment (no status checks). Degrade gracefully. |
| Large PR (>200 files) | Chunk diff into batches. Summarize per-batch then synthesize. Post note about chunked review. |
| Binary files in diff | Skip binary files silently. Mention skipped files in walkthrough. |

---

## Testing Strategy

| Layer | Scope |
|---|---|
| Unit | Config parsing, prompt construction, diff parsing, linter output normalization |
| Integration | Worker review pipeline with mocked GitHub API + mocked AI provider |
| E2E (API) | Webhook → worker → GitHub comment, using test GitHub App against fixture repo |
| E2E (UI) | Playwright — setup wizard flow, repo enable/disable, settings save, dashboard render |
| Fixtures | Curated set of PR diffs: binary files, large PRs, renames, empty PRs, fork PRs, draft PRs |

### Edge Cases Covered in Tests

- PRs with only binary file changes (skip gracefully, mention in walkthrough)
- PRs exceeding token limits (>200 files) → chunking strategy
- Empty PRs (no code changes, CI-only)
- Draft PRs (configurable: skip or review)
- PRs from forks (no write access to repo secrets → graceful degradation)
- Repos with no config file (fall back to defaults)
- Invalid AI API key → helpful error comment on PR
- Webhook signature mismatch → silent `403`
- Config with both `.openbunny.json` and `.openbunny.yaml` present (JSON wins)

---

## Licensing

**FSL-1.0-Apache-2.0 (Functional Source License)**

- **Allowed:** Use, fork, modify for any non-competing purpose; self-hosting; contribution
- **Not allowed:** Running OpenBunny as a competing hosted service without a commercial license
- **After 2 years:** Each version converts to Apache 2.0 (fully open source)

This protects the paid cloud version from direct cloning while keeping the source visible and community-friendly. No OSI approval, but widely understood and accepted (used by Sentry, Gitpod).

A CLA (Contributor License Agreement) will be required for contributions, granting the project maintainers rights to include contributions in the commercial cloud version.

---

## AI API Key Configuration

### Self-Hosted
AI API keys are configured through the OpenBunny Settings UI after first-run setup. They are stored AES-256 encrypted in the `app_config` table. No secrets need to be placed in `.env` files or `docker-compose.yml`.

The Settings page (v1) exposes:
- **OpenAI API key** — masked input, stored encrypted
- **Review model** — dropdown: `gpt-4o`, `gpt-4.1`, `o4-mini`
- **Light model** (summaries/walkthroughs) — dropdown: `gpt-4o-mini`, `gpt-4.1-mini`

Per-repo overrides via `.openbunny.yaml` are still supported for model selection (not for API keys):
```yaml
ai:
  provider: openai
  model: gpt-4o
  light_model: gpt-4o-mini
```

**Key rotation:** Update in Settings UI → takes effect on next review job. No container restart needed.

### Cloud Version
Users enter their AI API key in the OpenBunny dashboard (Settings → AI Provider). Keys are stored AES-256 encrypted in Postgres and injected into the worker at job runtime. Users can choose to use their own key or the platform's managed key (Pro plan includes pooled key access).

---

## Monetization (Cloud Version)

| Tier | Price | Features |
|---|---|---|
| **Free** | $0 | Open source repos, 50 PRs/month, community support |
| **Pro** | $15–20/contributing dev/month | Unlimited PRs, all linters + security tools, analytics, priority support |
| **Enterprise** | Custom | Self-hosted with SLA, SSO/SAML, dedicated support, custom rules |

**Contributing developer** = any user who opens a PR that gets reviewed in the billing month.

---

## Roadmap (Post-v1)

| Phase | Features |
|---|---|
| **v2** | Org learnings system (persist team-specific rules from review feedback), analytics dashboard, GitLab support |
| **Pro tier** | Full codebase graph indexing (pgvector + call graph), blast radius analysis, Jira/Linear integration |
| **Pro tier** | Auto-approve workflow (mark approved when all review comments resolved), docstring generation, unit test generation |
| **Pro tier** | Sequence diagram generation for PR walkthroughs |
| **Enterprise** | SSO/SAML, multi-org support, custom AST-grep rules, MCP client integration |
