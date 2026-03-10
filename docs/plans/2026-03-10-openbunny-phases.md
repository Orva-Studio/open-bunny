# OpenBunny — Phased Build Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build OpenBunny — a self-hostable AI PR review platform with a guided setup wizard, GitHub App Manifest flow, and an OpenAI-backed review engine.

**Architecture:** Modular monolith. Hono/Bun API server receives GitHub webhooks → enqueues BullMQ jobs → worker fetches diff, runs linters/security tools, calls AI, posts comments. React + Vite SPA for the dashboard. First-run wizard handles GitHub App creation and repo selection with zero manual credential setup.

**Tech Stack:** Bun, TypeScript, Hono, React + Vite, Prisma ORM, PostgreSQL, Redis, BullMQ, Octokit, Vercel AI SDK, Better Auth, Zod, Playwright

---

## Pre-Build: Fix 3 Known Plan Gaps

These must be resolved before or during Phase 2 — they affect every subsequent phase.

### Gap 1: Define `crypto.ts`

**Files:**
- Create: `src/lib/crypto.ts`

AES-256-GCM `encrypt(plaintext: string): string` and `decrypt(ciphertext: string): string` using `process.env["ENCRYPTION_KEY"]`. Called by setup routes, worker, and settings API.

**Step 1: Write failing test** `src/lib/crypto.test.ts`

```typescript
import { describe, test, expect } from "bun:test";
import { encrypt, decrypt } from "./crypto";

describe("crypto", () => {
  test("round-trips plaintext", () => {
    process.env["ENCRYPTION_KEY"] = "a".repeat(64); // 32-byte hex
    const plaintext = "sk-test-key-12345";
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  test("produces different ciphertext each call (random IV)", () => {
    process.env["ENCRYPTION_KEY"] = "a".repeat(64);
    const c1 = encrypt("same");
    const c2 = encrypt("same");
    expect(c1).not.toBe(c2);
  });
});
```

**Step 2: Run to verify it fails**

```bash
bun test src/lib/crypto.test.ts
```

Expected: FAIL — `encrypt` not defined

**Step 3: Implement `src/lib/crypto.ts`**

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function getKey(): Buffer {
  const hex = process.env["ENCRYPTION_KEY"];
  if (!hex || hex.length !== 64) throw new Error("ENCRYPTION_KEY must be a 32-byte hex string");
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decrypt(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
```

**Step 4: Run tests**

```bash
bun test src/lib/crypto.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/crypto.ts src/lib/crypto.test.ts
git commit -m "feat(lib): add AES-256-GCM encrypt/decrypt utility"
```

---

### Gap 2: Load webhook secret from DB, not env var

**Files:**
- Modify: `src/api/routes/webhook.ts`
- Modify: `src/api/index.ts`

The webhook HMAC validation currently reads `GITHUB_WEBHOOK_SECRET` from env. It must instead load the secret from `app_config` in Postgres.

**Step 1: Update `src/api/index.ts`**

Replace the `if (process.env["GITHUB_WEBHOOK_SECRET"])` guard with a DB lookup at startup:

```typescript
const appCfg = await db.query.appConfig.findFirst();
if (appCfg?.githubWebhookSecretEncrypted) {
  const webhookSecret = decrypt(appCfg.githubWebhookSecretEncrypted);
  app.route("/api/webhooks", createWebhookRouter({ webhookSecret, reviewQueue, db }));
}
```

If `app_config` has no secret yet (pre-setup), webhook route is simply not mounted. This is correct — no App means no webhooks.

**Step 2: Commit**

```bash
git add src/api/index.ts
git commit -m "fix(api): load webhook secret from app_config instead of env var"
```

---

### Gap 3: Update README quick-start to reflect setup wizard

**Files:**
- Modify: `README.md`

Replace the old "Create GitHub App manually" quick-start steps with:

```markdown
## Quick Start (Self-Hosted)

### 1. Configure environment

```bash
cp .env.example .env
# Set POSTGRES_PASSWORD, BASE_URL, and ENCRYPTION_KEY
# Generate ENCRYPTION_KEY: openssl rand -hex 32
```

### 2. Start OpenBunny

```bash
docker-compose up -d
```

### 3. Open the dashboard

Visit http://localhost:3001 and follow the setup wizard:
1. Create admin account
2. Connect GitHub (one-click App creation)
3. Select repositories

That's it — OpenBunny will start reviewing PRs automatically.
```

**Step 1: Update README.md**

Apply the above quick-start section.

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update quick-start to reflect setup wizard flow"
```

---

## Phase 1: Monorepo Foundation

**Dependency:** None — start here.

- [ ] **Task 1** — Scaffold root package (`package.json`, `tsconfig.json`, `.gitignore`, `prisma/schema.prisma`)
- [ ] **Task 2** — Create directory structure (`src/api`, `src/worker`, `src/lib`, `apps/ui`, `apps/e2e`)
- [ ] **Task 2b** — `apps/e2e`: Playwright setup (`playwright.config.ts`, `seed.ts`, base fixtures)

**Commit:** `feat: scaffold root package with flat src layout and Playwright`

---

## Phase 2: Core Packages

**Dependency:** Phase 1

- [ ] **Task 3** — `src/lib/config.ts`: Zod config schema (`parseConfig`, `.openbunny.json`/`.yaml` loading)
- [ ] **Task 4** — `prisma/schema.prisma` + `src/lib/db.ts`: Prisma schema and client singleton
- [ ] **Task 5** — `src/lib/github.ts`: Octokit wrapper, `verifyWebhookSignature`, `getInstallationOctokit`
- [ ] **Gap 1** — `src/lib/crypto.ts`: AES-256-GCM encrypt/decrypt

**Can run in parallel:** Tasks 3, 5, and Gap 1 are independent once Task 2 is done.

---

## Phase 3: AI Gateway

**Dependency:** Phase 1 only (independent of Phase 2)

- [ ] **Task 6** — `src/lib/ai.ts`: Vercel AI SDK gateway (`createAIModel`, supports `openai`, `anthropic`, `google`, `openai-compatible`, `ollama`)

**Packages:** `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`, `ollama-ai-provider`

---

## Phase 4: API Server

**Dependency:** Phases 2 + 3

- [ ] **Task 7** — `src/api`: Hono server, `env.ts`, health route, webhook route (`pull_request` events → BullMQ)
- [ ] **Task 15a** — Better Auth setup (`src/api/auth.ts`), `app_config` table migration
- [ ] **Task 15b** — Setup API routes (`/api/setup/status`, `/api/setup/admin`, `/api/github/manifest`, `/api/github/manifest-callback`, `/api/github/install-callback`)
- [ ] **Task 15c** — `installation.created` / `installation_repositories` webhook handler (stores repos as disabled)
- [ ] **Task 15d** — Repos API (`GET /api/repos`, `PATCH /api/repos/:id`, `POST /api/repos/auto-enroll`)
- [ ] **Task 15e** — Settings API (`GET /api/settings`, `PATCH /api/settings`)
- [ ] **Gap 2** — Load webhook secret from `app_config` DB at startup

**Note:** Tasks 15b–15e can be built in parallel once Task 15a is done.

---

## Phase 5: Worker Pipeline

**Dependency:** Phases 2 + 3 + 4 (needs DB schema, AI gateway, and job queue)

- [ ] **Task 8** — `src/lib/linters/`: ESLint, Ruff, ShellCheck runners (sandboxed subprocesses)
- [ ] **Task 9** — `src/lib/security/`: Semgrep, Gitleaks, Trivy wrappers
- [ ] **Task 10** — `src/lib/context/`: Smart context retrieval (embedding + code search for callers/callees)
- [ ] **Task 11** — `src/worker`: BullMQ worker setup, `env.ts`, job consumer
- [ ] **Task 12** — Review pipeline: diff parsing, path filters, trivial change detection
- [ ] **Task 13** — AI prompt construction + review posting (summary, walkthrough, inline comments)
- [ ] **Task 14** — Chat command handler (`@openbunny review`, `pause`, `resume`, `ignore`, `help`)

**Can run in parallel:** Tasks 8, 9, 10 are independent library packages.

---

## Phase 6: Web Dashboard

**Dependency:** Phase 4 (needs API endpoints)

- [ ] **Task 15f** — `apps/ui`: React + Vite SPA
  - Setup wizard (3 steps: admin account → GitHub App → repo install)
  - Repos page (list with enable/disable toggles + PR stats)
  - Settings page (OpenAI API key, review model, light model dropdowns)
  - Dashboard page (recent reviews)
- [ ] **Task 15g** — Playwright E2E tests for all UI flows
  - Setup wizard: complete all 3 steps, verify redirect to repos page
  - Repos page: enable a repo, verify toggle state persists after reload
  - Settings page: enter API key + select model, save, verify masked key shown
  - Dashboard: renders without errors when no reviews exist

**Routing:** UI checks `/api/setup/status` on load. If `setupComplete: false` → redirects to `/setup`. Otherwise shows main nav.

---

## Phase 7: Docker Compose & Docs

**Dependency:** All phases complete

- [ ] **Task 16** — `docker-compose.yml` (5 services: postgres, redis, api, worker, ui), Dockerfiles for each app, `.env.example`
- [ ] **Task 17** — `LICENSE` (FSL-1.0-Apache-2.0), `README.md` (setup wizard quick-start), `docs/setup/`
- [ ] **Gap 3** — Update README quick-start to match wizard flow

---

## Parallelisation Map

```
Phase 1 (foundation)
    │
    ├── Phase 2 (core lib) ───────────────────────────────────┐
    │       ├── Task 3 (config)                               │
    │       ├── Task 4 (DB schema)                            │
    │       ├── Task 5 (GitHub SDK)      ← in parallel        │
    │       └── Gap 1 (crypto)                                │
    │                                                         │
    └── Phase 3 (AI gateway) ─────────────────────────────────┤
                                                              │
                                              Phase 4 (API server)
                                                  │
                                              Phase 5 (worker) ← Tasks 8/9/10 in parallel
                                                  │
                                              Phase 6 (UI)
                                                  │
                                              Phase 7 (Docker + docs)
```

---

## Final Verification

```bash
# All tests pass
bun test

# TypeScript compiles clean
bun run build

# Docker images build
docker-compose build

# Start stack and run through setup wizard manually
docker-compose up -d
# Visit http://localhost:3001 and complete wizard
```

---

## Execution Options

**Option A — Subagent-Driven (this session)**
Use `superpowers:subagent-driven-development`. Dispatch one subagent per task, review between tasks.
Best for: fast iteration, staying in one session.

**Option B — Parallel Session**
Open a new Claude Code session in a worktree. Use `superpowers:executing-plans` pointing at `docs/plans/2026-03-04-openbunny-implementation.md`.
Best for: long execution runs, separation from planning context.
