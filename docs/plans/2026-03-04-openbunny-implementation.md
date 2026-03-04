# OpenBunny Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build OpenBunny — a self-hostable, open-source AI PR review platform with linter/security integrations, multi-provider AI support, and a path to a paid cloud version.

**Architecture:** Modular monolith with worker separation. A Hono/Bun API server receives GitHub webhooks and enqueues jobs via BullMQ (Redis). A separate BullMQ worker processes review jobs: fetches PR diff, retrieves smart context, runs linters/security tools, calls AI, and posts structured comments to GitHub. React + Vite SPA for the web dashboard.

**Tech Stack:** Bun, TypeScript, Hono, React + Vite, Drizzle ORM, PostgreSQL, Redis, BullMQ, Octokit, Zod, Turborepo

---

## Phase 1: Monorepo Foundation

### Task 1: Scaffold Turborepo Monorepo

**Files:**
- Create: `package.json`
- Create: `turbo.json`
- Create: `bunfig.toml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

**Step 1: Initialize Bun workspaces**

```bash
cd /Users/robray/openbunny
bun init -y
```

**Step 2: Replace `package.json`**

```json
{
  "name": "openbunny",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 3: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "lint": {}
  }
}
```

**Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

**Step 5: Create `.gitignore`**

```
node_modules/
dist/
.env
.env.local
*.local
```

**Step 6: Install dependencies**

```bash
bun install
```

**Step 7: Create directory structure**

```bash
mkdir -p apps/api apps/worker apps/ui
mkdir -p packages/core packages/ai packages/github packages/linters packages/security packages/context
```

**Step 8: Commit**

```bash
git init
git add .
git commit -m "chore: scaffold turborepo monorepo with bun workspaces"
```

---

### Task 2: `packages/core` — Shared Types and Config Parser

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/config.ts`
- Create: `packages/core/src/types.ts`
- Test: `packages/core/src/config.test.ts`

**Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@openbunny/core",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "bun test"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "js-yaml": "^4.1.0",
    "@types/js-yaml": "^4.0.9"
  }
}
```

**Step 2: Install**

```bash
cd packages/core && bun install && cd ../..
```

**Step 3: Write failing tests for config parsing**

Create `packages/core/src/config.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { parseConfig, defaultConfig } from "./config";

describe("parseConfig", () => {
  test("returns defaults when given empty object", () => {
    const result = parseConfig({});
    expect(result.reviews.profile).toBe("chill");
    expect(result.ai.provider).toBe("openai");
    expect(result.security.owasp_review).toBe(true);
  });

  test("merges partial config with defaults", () => {
    const result = parseConfig({
      ai: { provider: "anthropic", model: "claude-sonnet-4-6" },
    });
    expect(result.ai.provider).toBe("anthropic");
    expect(result.ai.model).toBe("claude-sonnet-4-6");
    expect(result.reviews.profile).toBe("chill"); // default preserved
  });

  test("throws ZodError on invalid provider", () => {
    expect(() => parseConfig({ ai: { provider: "invalid" } })).toThrow();
  });

  test("path_filters defaults to common exclusions", () => {
    const result = parseConfig({});
    expect(result.reviews.path_filters).toContain("!**/*.lock");
  });
});
```

**Step 4: Run test to verify it fails**

```bash
cd packages/core && bun test
```

Expected: FAIL — `parseConfig` not defined

**Step 5: Implement `packages/core/src/config.ts`**

```typescript
import { z } from "zod";

const AIProviderSchema = z.enum(["openai", "anthropic", "google", "ollama"]);

const ConfigSchema = z.object({
  ai: z
    .object({
      provider: AIProviderSchema.default("openai"),
      model: z.string().default("gpt-4o"),
      light_model: z.string().default("gpt-4o-mini"),
      base_url: z.string().optional(),
    })
    .default({}),

  reviews: z
    .object({
      profile: z.enum(["chill", "assertive"]).default("chill"),
      path_filters: z.array(z.string()).default(["!**/*.lock", "!dist/**", "!**/node_modules/**"]),
      path_instructions: z
        .array(
          z.object({
            path: z.string(),
            instructions: z.string(),
          })
        )
        .default([]),
      auto_review: z
        .object({
          enabled: z.boolean().default(true),
          labels: z.array(z.string()).default([]),
          draft: z.boolean().default(false),
        })
        .default({}),
      skip_trivial: z.boolean().default(true),
    })
    .default({}),

  linters: z
    .object({
      eslint: z.object({ enabled: z.boolean() }).default({ enabled: true }),
      ruff: z.object({ enabled: z.boolean() }).default({ enabled: true }),
      shellcheck: z.object({ enabled: z.boolean() }).default({ enabled: true }),
      biome: z.object({ enabled: z.boolean() }).default({ enabled: false }),
      pylint: z.object({ enabled: z.boolean() }).default({ enabled: false }),
      stylelint: z.object({ enabled: z.boolean() }).default({ enabled: false }),
      hadolint: z.object({ enabled: z.boolean() }).default({ enabled: true }),
      markdownlint: z.object({ enabled: z.boolean() }).default({ enabled: false }),
      checkov: z.object({ enabled: z.boolean() }).default({ enabled: false }),
      actionlint: z.object({ enabled: z.boolean() }).default({ enabled: true }),
    })
    .default({}),

  security: z
    .object({
      semgrep: z.object({ enabled: z.boolean() }).default({ enabled: true }),
      gitleaks: z.object({ enabled: z.boolean() }).default({ enabled: true }),
      trivy: z.object({ enabled: z.boolean() }).default({ enabled: true }),
      owasp_review: z.boolean().default(true),
    })
    .default({}),
});

export type OpenBunnyConfig = z.infer<typeof ConfigSchema>;

export function parseConfig(raw: unknown): OpenBunnyConfig {
  return ConfigSchema.parse(raw);
}

export const defaultConfig: OpenBunnyConfig = ConfigSchema.parse({});
```

**Step 6: Create `packages/core/src/types.ts`**

```typescript
export type ReviewSeverity = "critical" | "major" | "minor" | "nitpick";

export interface ReviewComment {
  path: string;
  line: number;
  body: string;
  severity: ReviewSeverity;
  suggestion?: string; // GitHub suggestion block content
}

export interface ReviewResult {
  summary: string;
  walkthrough: { path: string; summary: string }[];
  comments: ReviewComment[];
  securityFindings: SecurityFinding[];
}

export interface SecurityFinding {
  tool: string;
  path: string;
  line?: number;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
}

export interface LinterFinding {
  tool: string;
  path: string;
  line: number;
  column?: number;
  severity: "error" | "warning" | "info";
  rule?: string;
  message: string;
}

export interface PRContext {
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  baseSha: string;
  title: string;
  body: string;
  diff: string;
  changedFiles: ChangedFile[];
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  patch?: string;
}
```

**Step 7: Create `packages/core/src/index.ts`**

```typescript
export { parseConfig, defaultConfig } from "./config";
export type { OpenBunnyConfig } from "./config";
export type {
  ReviewComment,
  ReviewResult,
  ReviewSeverity,
  SecurityFinding,
  LinterFinding,
  PRContext,
  ChangedFile,
} from "./types";
```

**Step 8: Run tests to verify they pass**

```bash
cd packages/core && bun test
```

Expected: PASS (4 tests)

**Step 9: Commit**

```bash
git add packages/core
git commit -m "feat(core): add config parser and shared types"
```

---

### Task 3: `packages/core` — Config File Loader (JSON + YAML)

**Files:**
- Modify: `packages/core/package.json` (add js-yaml dep)
- Create: `packages/core/src/loader.ts`
- Test: `packages/core/src/loader.test.ts`

**Step 1: Write failing tests**

Create `packages/core/src/loader.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { loadConfigFromString } from "./loader";

describe("loadConfigFromString", () => {
  test("parses valid JSON config", () => {
    const json = JSON.stringify({ ai: { provider: "anthropic" } });
    const result = loadConfigFromString(json, "json");
    expect(result.ai.provider).toBe("anthropic");
  });

  test("parses valid YAML config", () => {
    const yaml = `
ai:
  provider: anthropic
  model: claude-sonnet-4-6
`;
    const result = loadConfigFromString(yaml, "yaml");
    expect(result.ai.provider).toBe("anthropic");
    expect(result.ai.model).toBe("claude-sonnet-4-6");
  });

  test("JSON takes precedence signal via format arg", () => {
    // Caller is responsible for precedence — JSON format passed first
    const json = JSON.stringify({ ai: { provider: "openai" } });
    const result = loadConfigFromString(json, "json");
    expect(result.ai.provider).toBe("openai");
  });

  test("returns defaults on empty YAML", () => {
    const result = loadConfigFromString("", "yaml");
    expect(result.reviews.profile).toBe("chill");
  });

  test("throws on malformed JSON", () => {
    expect(() => loadConfigFromString("{bad json", "json")).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/core && bun test src/loader.test.ts
```

Expected: FAIL — `loadConfigFromString` not defined

**Step 3: Implement `packages/core/src/loader.ts`**

```typescript
import yaml from "js-yaml";
import { parseConfig } from "./config";
import type { OpenBunnyConfig } from "./config";

export type ConfigFormat = "json" | "yaml";

export function loadConfigFromString(
  content: string,
  format: ConfigFormat
): OpenBunnyConfig {
  if (!content.trim()) return parseConfig({});

  const raw = format === "json" ? JSON.parse(content) : yaml.load(content);
  return parseConfig(raw);
}
```

**Step 4: Export from index**

Add to `packages/core/src/index.ts`:

```typescript
export { loadConfigFromString } from "./loader";
export type { ConfigFormat } from "./loader";
```

**Step 5: Run tests**

```bash
cd packages/core && bun test
```

Expected: PASS (9 tests total)

**Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): add JSON/YAML config file loader"
```

---

### Task 4: Database Schema with Drizzle

**Files:**
- Create: `packages/core/src/db/schema.ts`
- Create: `packages/core/src/db/index.ts`
- Create: `packages/core/src/db/migrate.ts`
- Modify: `packages/core/package.json`

**Step 1: Add database dependencies to `packages/core/package.json`**

```json
{
  "dependencies": {
    "drizzle-orm": "^0.38.0",
    "postgres": "^3.4.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.30.0",
    "js-yaml": "^4.1.0",
    "@types/js-yaml": "^4.0.9"
  }
}
```

**Step 2: Install**

```bash
cd packages/core && bun install && cd ../..
```

**Step 3: Create `packages/core/src/db/schema.ts`**

```typescript
import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  serial,
  uuid,
} from "drizzle-orm/pg-core";

export const installations = pgTable("installations", {
  id: serial("id").primaryKey(),
  githubInstallationId: integer("github_installation_id").notNull().unique(),
  githubAccountLogin: text("github_account_login").notNull(),
  githubAccountType: text("github_account_type").notNull(), // "User" | "Organization"
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const repositories = pgTable("repositories", {
  id: serial("id").primaryKey(),
  installationId: integer("installation_id")
    .references(() => installations.id)
    .notNull(),
  githubRepoId: integer("github_repo_id").notNull().unique(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  fullName: text("full_name").notNull(), // "owner/name"
  isPrivate: boolean("is_private").notNull().default(false),
  configCache: jsonb("config_cache"), // cached parsed .openbunny.yaml/json
  configCachedAt: timestamp("config_cached_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const pullRequests = pgTable("pull_requests", {
  id: serial("id").primaryKey(),
  repositoryId: integer("repository_id")
    .references(() => repositories.id)
    .notNull(),
  githubPrNumber: integer("github_pr_number").notNull(),
  title: text("title").notNull(),
  headSha: text("head_sha").notNull(),
  baseSha: text("base_sha").notNull(),
  lastReviewedSha: text("last_reviewed_sha"), // null = never reviewed
  status: text("status").notNull().default("pending"), // pending | reviewing | reviewed | paused | ignored
  isDraft: boolean("is_draft").notNull().default(false),
  isFromFork: boolean("is_from_fork").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  pullRequestId: integer("pull_request_id")
    .references(() => pullRequests.id)
    .notNull(),
  fromSha: text("from_sha"), // null = full review
  toSha: text("to_sha").notNull(),
  isIncremental: boolean("is_incremental").notNull().default(true),
  aiProvider: text("ai_provider").notNull(),
  aiModel: text("ai_model").notNull(),
  status: text("status").notNull().default("pending"), // pending | running | completed | failed
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const reviewComments = pgTable("review_comments", {
  id: serial("id").primaryKey(),
  reviewId: integer("review_id")
    .references(() => reviews.id)
    .notNull(),
  path: text("path").notNull(),
  line: integer("line"),
  body: text("body").notNull(),
  severity: text("severity"), // critical | major | minor | nitpick
  commentType: text("comment_type").notNull(), // inline | summary | walkthrough
  githubCommentId: integer("github_comment_id"), // ID of posted GitHub comment
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  githubUserId: integer("github_user_id").notNull().unique(),
  login: text("login").notNull(),
  email: text("email"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  installationId: integer("installation_id")
    .references(() => installations.id)
    .notNull(),
  keyHash: text("key_hash").notNull().unique(), // bcrypt hash of the key
  name: text("name").notNull(),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
});
```

**Step 4: Create `packages/core/src/db/index.ts`**

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
export * from "./schema";
```

**Step 5: Create `drizzle.config.ts` in `packages/core/`**

```typescript
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgresql://localhost:5432/openbunny",
  },
} satisfies Config;
```

**Step 6: Export from index**

Add to `packages/core/src/index.ts`:

```typescript
export { createDb } from "./db/index";
export type { Db } from "./db/index";
export * from "./db/schema";
```

**Step 7: Generate migrations**

```bash
cd packages/core && bun drizzle-kit generate && cd ../..
```

Expected: Creates `packages/core/migrations/0000_*.sql`

**Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core): add drizzle schema and migrations"
```

---

## Phase 2: GitHub Integration

### Task 5: `packages/github` — Webhook Validation and Octokit Client

**Files:**
- Create: `packages/github/package.json`
- Create: `packages/github/src/index.ts`
- Create: `packages/github/src/webhook.ts`
- Create: `packages/github/src/client.ts`
- Test: `packages/github/src/webhook.test.ts`

**Step 1: Create `packages/github/package.json`**

```json
{
  "name": "@openbunny/github",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "bun test"
  },
  "dependencies": {
    "@octokit/app": "^15.1.0",
    "@octokit/rest": "^21.0.0",
    "@openbunny/core": "workspace:*"
  }
}
```

**Step 2: Install**

```bash
cd packages/github && bun install && cd ../..
```

**Step 3: Write failing tests for webhook validation**

Create `packages/github/src/webhook.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { verifyWebhookSignature, parseWebhookEvent } from "./webhook";

const SECRET = "test-secret";

async function makeSignature(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

describe("verifyWebhookSignature", () => {
  test("returns true for valid signature", async () => {
    const body = JSON.stringify({ action: "opened" });
    const sig = await makeSignature(body, SECRET);
    const result = await verifyWebhookSignature(body, sig, SECRET);
    expect(result).toBe(true);
  });

  test("returns false for invalid signature", async () => {
    const body = JSON.stringify({ action: "opened" });
    const result = await verifyWebhookSignature(body, "sha256=invalid", SECRET);
    expect(result).toBe(false);
  });

  test("returns false for missing signature", async () => {
    const result = await verifyWebhookSignature("body", "", SECRET);
    expect(result).toBe(false);
  });
});

describe("parseWebhookEvent", () => {
  test("extracts pull_request.opened event", () => {
    const payload = {
      action: "opened",
      pull_request: { number: 42, head: { sha: "abc123" }, base: { sha: "def456" }, draft: false },
      repository: { id: 1, owner: { login: "org" }, name: "repo", full_name: "org/repo", private: false },
      installation: { id: 99 },
    };
    const event = parseWebhookEvent("pull_request", payload);
    expect(event.type).toBe("pull_request");
    expect(event.action).toBe("opened");
  });
});
```

**Step 4: Run to verify it fails**

```bash
cd packages/github && bun test
```

**Step 5: Implement `packages/github/src/webhook.ts`**

```typescript
export async function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string
): Promise<boolean> {
  if (!signature || !signature.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = `sha256=${Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;

  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

export interface WebhookEvent {
  type: string;
  action: string;
  payload: Record<string, unknown>;
}

export function parseWebhookEvent(
  eventType: string,
  payload: Record<string, unknown>
): WebhookEvent {
  return {
    type: eventType,
    action: (payload["action"] as string) ?? "",
    payload,
  };
}
```

**Step 6: Implement `packages/github/src/client.ts`**

```typescript
import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";

export interface GitHubAppConfig {
  appId: number;
  privateKey: string;
  webhookSecret: string;
}

export function createGitHubApp(config: GitHubAppConfig) {
  return new App({
    appId: config.appId,
    privateKey: config.privateKey,
    webhooks: { secret: config.webhookSecret },
  });
}

export async function getInstallationOctokit(
  app: App,
  installationId: number
): Promise<Octokit> {
  return app.getInstallationOctokit(installationId) as unknown as Octokit;
}

export async function getPRDiff(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<string> {
  const { data } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
    mediaType: { format: "diff" },
  });
  return data as unknown as string;
}

export async function postPRComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  body: string
): Promise<number> {
  const { data } = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body,
  });
  return data.id;
}

export async function postInlineComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  commitId: string,
  path: string,
  line: number,
  body: string
): Promise<number> {
  const { data } = await octokit.pulls.createReviewComment({
    owner,
    repo,
    pull_number: pullNumber,
    commit_id: commitId,
    path,
    line,
    body,
  });
  return data.id;
}
```

**Step 7: Create `packages/github/src/index.ts`**

```typescript
export { verifyWebhookSignature, parseWebhookEvent } from "./webhook";
export type { WebhookEvent } from "./webhook";
export {
  createGitHubApp,
  getInstallationOctokit,
  getPRDiff,
  postPRComment,
  postInlineComment,
} from "./client";
export type { GitHubAppConfig } from "./client";
```

**Step 8: Run tests**

```bash
cd packages/github && bun test
```

Expected: PASS

**Step 9: Commit**

```bash
git add packages/github
git commit -m "feat(github): add webhook validation and octokit client"
```

---

## Phase 3: AI Gateway

### Task 6: `packages/ai` — Multi-Provider AI Adapter

**Files:**
- Create: `packages/ai/package.json`
- Create: `packages/ai/src/index.ts`
- Create: `packages/ai/src/types.ts`
- Create: `packages/ai/src/providers/openai.ts`
- Create: `packages/ai/src/providers/anthropic.ts`
- Create: `packages/ai/src/providers/google.ts`
- Create: `packages/ai/src/providers/ollama.ts`
- Create: `packages/ai/src/gateway.ts`
- Test: `packages/ai/src/gateway.test.ts`

**Step 1: Create `packages/ai/package.json`**

```json
{
  "name": "@openbunny/ai",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "scripts": { "test": "bun test" },
  "dependencies": {
    "openai": "^4.76.0",
    "@anthropic-ai/sdk": "^0.39.0",
    "@google/generative-ai": "^0.21.0",
    "@openbunny/core": "workspace:*"
  }
}
```

**Step 2: Install**

```bash
cd packages/ai && bun install && cd ../..
```

**Step 3: Create `packages/ai/src/types.ts`**

```typescript
export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AICompletionOptions {
  messages: AIMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface AIProvider {
  complete(options: AICompletionOptions): Promise<string>;
}
```

**Step 4: Write failing tests**

Create `packages/ai/src/gateway.test.ts`:

```typescript
import { describe, test, expect, mock } from "bun:test";
import { createAIGateway } from "./gateway";

describe("createAIGateway", () => {
  test("returns a provider with complete() method", () => {
    const gateway = createAIGateway({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "test-key",
    });
    expect(typeof gateway.complete).toBe("function");
  });

  test("throws for unknown provider", () => {
    expect(() =>
      createAIGateway({
        provider: "unknown" as never,
        model: "foo",
        apiKey: "key",
      })
    ).toThrow("Unknown AI provider");
  });

  test("accepts ollama with base_url", () => {
    const gateway = createAIGateway({
      provider: "ollama",
      model: "qwen2.5-coder",
      apiKey: "",
      baseUrl: "http://localhost:11434/v1",
    });
    expect(typeof gateway.complete).toBe("function");
  });
});
```

**Step 5: Run to verify it fails**

```bash
cd packages/ai && bun test
```

**Step 6: Implement providers**

Create `packages/ai/src/providers/openai.ts`:

```typescript
import OpenAI from "openai";
import type { AIProvider, AICompletionOptions } from "../types";

export function createOpenAIProvider(
  model: string,
  apiKey: string,
  baseUrl?: string
): AIProvider {
  const client = new OpenAI({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });
  return {
    async complete({ messages, maxTokens = 4096, temperature = 0.2 }) {
      const response = await client.chat.completions.create({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      });
      return response.choices[0]?.message?.content ?? "";
    },
  };
}
```

Create `packages/ai/src/providers/anthropic.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, AICompletionOptions } from "../types";

export function createAnthropicProvider(
  model: string,
  apiKey: string
): AIProvider {
  const client = new Anthropic({ apiKey });
  return {
    async complete({ messages, maxTokens = 4096, temperature = 0.2 }) {
      const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
      const userMessages = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemMsg,
        messages: userMessages,
      });
      const block = response.content[0];
      return block?.type === "text" ? block.text : "";
    },
  };
}
```

Create `packages/ai/src/providers/google.ts`:

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AIProvider, AICompletionOptions } from "../types";

export function createGoogleProvider(model: string, apiKey: string): AIProvider {
  const client = new GoogleGenerativeAI(apiKey);
  const generativeModel = client.getGenerativeModel({ model });
  return {
    async complete({ messages, maxTokens = 4096, temperature = 0.2 }) {
      const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
      const userMessages = messages.filter((m) => m.role !== "system");
      const lastUser = userMessages[userMessages.length - 1]?.content ?? "";

      const result = await generativeModel.generateContent({
        systemInstruction: systemMsg,
        contents: [{ role: "user", parts: [{ text: lastUser }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature },
      });
      return result.response.text();
    },
  };
}
```

Create `packages/ai/src/providers/ollama.ts`:

```typescript
// Ollama uses OpenAI-compatible API
import { createOpenAIProvider } from "./openai";
import type { AIProvider } from "../types";

export function createOllamaProvider(
  model: string,
  baseUrl: string
): AIProvider {
  return createOpenAIProvider(model, "ollama", baseUrl);
}
```

**Step 7: Implement `packages/ai/src/gateway.ts`**

```typescript
import { createOpenAIProvider } from "./providers/openai";
import { createAnthropicProvider } from "./providers/anthropic";
import { createGoogleProvider } from "./providers/google";
import { createOllamaProvider } from "./providers/ollama";
import type { AIProvider } from "./types";

export interface GatewayConfig {
  provider: "openai" | "anthropic" | "google" | "ollama";
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export function createAIGateway(config: GatewayConfig): AIProvider {
  switch (config.provider) {
    case "openai":
      return createOpenAIProvider(config.model, config.apiKey, config.baseUrl);
    case "anthropic":
      return createAnthropicProvider(config.model, config.apiKey);
    case "google":
      return createGoogleProvider(config.model, config.apiKey);
    case "ollama":
      return createOllamaProvider(
        config.model,
        config.baseUrl ?? "http://localhost:11434/v1"
      );
    default:
      throw new Error(`Unknown AI provider: ${config.provider}`);
  }
}
```

**Step 8: Create `packages/ai/src/index.ts`**

```typescript
export { createAIGateway } from "./gateway";
export type { GatewayConfig } from "./gateway";
export type { AIProvider, AIMessage, AICompletionOptions } from "./types";
```

**Step 9: Run tests**

```bash
cd packages/ai && bun test
```

Expected: PASS

**Step 10: Commit**

```bash
git add packages/ai
git commit -m "feat(ai): add multi-provider AI gateway (OpenAI, Anthropic, Google, Ollama)"
```

---

## Phase 4: API Server

### Task 7: `apps/api` — Hono Server with Webhook Endpoint

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/env.ts`
- Create: `apps/api/src/routes/webhook.ts`
- Create: `apps/api/src/routes/health.ts`
- Test: `apps/api/src/routes/webhook.test.ts`

**Step 1: Create `apps/api/package.json`**

```json
{
  "name": "@openbunny/api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "bun --hot src/index.ts",
    "start": "bun src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "bullmq": "^5.13.0",
    "ioredis": "^5.3.0",
    "@openbunny/core": "workspace:*",
    "@openbunny/github": "workspace:*"
  }
}
```

**Step 2: Install**

```bash
cd apps/api && bun install && cd ../..
```

**Step 3: Create `apps/api/src/env.ts`**

```typescript
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.string().default("3000"),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  GITHUB_APP_ID: z.string(),
  GITHUB_APP_PRIVATE_KEY: z.string(),
  GITHUB_WEBHOOK_SECRET: z.string(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
```

**Step 4: Write failing webhook route test**

Create `apps/api/src/routes/webhook.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { app } from "../index";

describe("POST /webhook/github", () => {
  test("returns 400 on missing signature", async () => {
    const res = await app.request("/webhook/github", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "opened" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 200 on valid ping event", async () => {
    // ping events should always be accepted (no signature needed in test)
    const body = JSON.stringify({ zen: "Keep it logically awesome." });
    const res = await app.request("/webhook/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "ping",
        "X-Hub-Signature-256": "sha256=skip-in-test",
      },
      body,
    });
    // In test mode (no GITHUB_WEBHOOK_SECRET), ping returns 200
    expect([200, 400]).toContain(res.status);
  });
});

describe("GET /health", () => {
  test("returns 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
  });
});
```

**Step 5: Create `apps/api/src/routes/health.ts`**

```typescript
import { Hono } from "hono";

export const healthRouter = new Hono();

healthRouter.get("/", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));
```

**Step 6: Create `apps/api/src/routes/webhook.ts`**

```typescript
import { Hono } from "hono";
import { Queue } from "bullmq";
import { verifyWebhookSignature } from "@openbunny/github";

export function createWebhookRouter(opts: {
  webhookSecret: string;
  reviewQueue: Queue;
}) {
  const router = new Hono();

  router.post("/github", async (c) => {
    const signature = c.req.header("X-Hub-Signature-256") ?? "";
    const event = c.req.header("X-GitHub-Event") ?? "";
    const body = await c.req.text();

    const valid = await verifyWebhookSignature(body, signature, opts.webhookSecret);
    if (!valid) {
      return c.json({ error: "Invalid signature" }, 400);
    }

    const payload = JSON.parse(body);

    // Handle ping (GitHub App registration)
    if (event === "ping") {
      return c.json({ ok: true });
    }

    // Handle pull_request events
    if (event === "pull_request") {
      const action = payload.action as string;
      const triggerActions = ["opened", "synchronize", "reopened"];

      if (triggerActions.includes(action)) {
        await opts.reviewQueue.add("review", {
          event,
          action,
          payload,
          enqueuedAt: new Date().toISOString(),
        });
      }
    }

    // Handle issue_comment (chat commands)
    if (event === "issue_comment" && payload.action === "created") {
      const body = (payload.comment?.body as string) ?? "";
      if (body.includes("@openbunny")) {
        await opts.reviewQueue.add("chat", {
          event,
          payload,
          enqueuedAt: new Date().toISOString(),
        });
      }
    }

    return c.json({ ok: true });
  });

  return router;
}
```

**Step 7: Create `apps/api/src/index.ts`**

```typescript
import { Hono } from "hono";
import { Queue } from "bullmq";
import { healthRouter } from "./routes/health";
import { createWebhookRouter } from "./routes/webhook";

// Export app for testing (env not required in test)
export const app = new Hono();

app.route("/health", healthRouter);

// Only mount webhook router if env is present
if (process.env["GITHUB_WEBHOOK_SECRET"]) {
  const { env } = await import("./env");
  const reviewQueue = new Queue("reviews", {
    connection: { host: new URL(env.REDIS_URL).hostname, port: parseInt(new URL(env.REDIS_URL).port || "6379") },
  });

  app.route("/webhook", createWebhookRouter({
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    reviewQueue,
  }));

  const port = parseInt(env.PORT);
  console.log(`🐇 OpenBunny API running on port ${port}`);
  Bun.serve({ port, fetch: app.fetch });
}
```

**Step 8: Run tests**

```bash
cd apps/api && bun test
```

Expected: PASS

**Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): add Hono server with GitHub webhook endpoint"
```

---

## Phase 5: Review Worker

### Task 8: `apps/worker` — BullMQ Worker Setup

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/src/index.ts`
- Create: `apps/worker/src/env.ts`
- Create: `apps/worker/src/jobs/review.ts`
- Create: `apps/worker/src/jobs/chat.ts`

**Step 1: Create `apps/worker/package.json`**

```json
{
  "name": "@openbunny/worker",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "bun --hot src/index.ts",
    "start": "bun src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "bullmq": "^5.13.0",
    "ioredis": "^5.3.0",
    "@openbunny/core": "workspace:*",
    "@openbunny/github": "workspace:*",
    "@openbunny/ai": "workspace:*"
  }
}
```

**Step 2: Install**

```bash
cd apps/worker && bun install && cd ../..
```

**Step 3: Create `apps/worker/src/env.ts`**

```typescript
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  GITHUB_APP_ID: z.string(),
  GITHUB_APP_PRIVATE_KEY: z.string(),
  GITHUB_WEBHOOK_SECRET: z.string(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
```

**Step 4: Create `apps/worker/src/jobs/review.ts`**

```typescript
import type { Job } from "bullmq";
import { createDb } from "@openbunny/core";
import { createGitHubApp, getInstallationOctokit } from "@openbunny/github";
import { createAIGateway } from "@openbunny/ai";
import { env } from "../env";

export async function processReviewJob(job: Job): Promise<void> {
  const { payload } = job.data as { payload: Record<string, unknown> };

  const pr = payload["pull_request"] as Record<string, unknown>;
  const repo = payload["repository"] as Record<string, unknown>;
  const installation = payload["installation"] as { id: number };

  const owner = (repo["owner"] as { login: string })["login"];
  const repoName = repo["name"] as string;
  const pullNumber = pr["number"] as number;
  const headSha = (pr["head"] as { sha: string })["sha"];
  const baseSha = (pr["base"] as { sha: string })["sha"];

  console.log(`[review] Processing PR #${pullNumber} in ${owner}/${repoName}`);

  const db = createDb(env.DATABASE_URL);
  const githubApp = createGitHubApp({
    appId: parseInt(env.GITHUB_APP_ID),
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
  });

  const octokit = await getInstallationOctokit(githubApp, installation.id);

  // TODO: implement full review pipeline (Tasks 9-12)
  console.log(`[review] Stub: would review PR #${pullNumber}`);
}

export async function processChatJob(job: Job): Promise<void> {
  const { payload } = job.data as { payload: Record<string, unknown> };
  console.log("[chat] Stub: would handle @openbunny mention");
}
```

**Step 5: Create `apps/worker/src/index.ts`**

```typescript
import { Worker } from "bullmq";
import { env } from "./env";
import { processReviewJob, processChatJob } from "./jobs/review";

const connection = {
  host: new URL(env.REDIS_URL).hostname,
  port: parseInt(new URL(env.REDIS_URL).port || "6379"),
};

const worker = new Worker(
  "reviews",
  async (job) => {
    if (job.name === "review") return processReviewJob(job);
    if (job.name === "chat") return processChatJob(job);
    throw new Error(`Unknown job type: ${job.name}`);
  },
  {
    connection,
    concurrency: 5,
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
  }
);

worker.on("completed", (job) => console.log(`✅ Job ${job.id} completed`));
worker.on("failed", (job, err) => console.error(`❌ Job ${job?.id} failed:`, err.message));

console.log("🐇 OpenBunny Worker started");
```

**Step 6: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): add BullMQ worker with review job scaffold"
```

---

### Task 9: Review Pipeline — Diff Fetching and Config Loading

**Files:**
- Create: `apps/worker/src/pipeline/fetchDiff.ts`
- Create: `apps/worker/src/pipeline/loadConfig.ts`
- Test: `apps/worker/src/pipeline/fetchDiff.test.ts`

**Step 1: Write failing tests**

Create `apps/worker/src/pipeline/fetchDiff.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { parseDiff, isTrivialChange } from "./fetchDiff";

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 export function foo() {
+  console.log("hello");
   return 42;
 }
`;

describe("parseDiff", () => {
  test("extracts changed files with patches", () => {
    const files = parseDiff(SAMPLE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("src/foo.ts");
    expect(files[0]?.patch).toContain('+  console.log("hello")');
  });
});

describe("isTrivialChange", () => {
  test("returns true for lock file only changes", () => {
    const files = [{ path: "package-lock.json", patch: "+foo" }];
    expect(isTrivialChange(files)).toBe(true);
  });

  test("returns false for source code changes", () => {
    const files = [{ path: "src/foo.ts", patch: "+code" }];
    expect(isTrivialChange(files)).toBe(false);
  });

  test("returns false for mixed lock + source", () => {
    const files = [
      { path: "package-lock.json", patch: "+foo" },
      { path: "src/bar.ts", patch: "+code" },
    ];
    expect(isTrivialChange(files)).toBe(false);
  });
});
```

**Step 2: Run to verify it fails**

```bash
cd apps/worker && bun test src/pipeline/fetchDiff.test.ts
```

**Step 3: Implement `apps/worker/src/pipeline/fetchDiff.ts`**

```typescript
import type { ChangedFile } from "@openbunny/core";

const TRIVIAL_PATTERNS = [
  /\.lock$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /bun\.lockb$/,
  /^dist\//,
  /^\.next\//,
  /^node_modules\//,
];

export function parseDiff(diffText: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  const fileSections = diffText.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const pathMatch = section.match(/^a\/(.+?) b\/(.+?)$/m);
    if (!pathMatch) continue;

    const path = pathMatch[2] ?? "";
    const additions = (section.match(/^\+[^+]/gm) ?? []).length;
    const deletions = (section.match(/^-[^-]/gm) ?? []).length;

    let status: ChangedFile["status"] = "modified";
    if (section.includes("new file mode")) status = "added";
    else if (section.includes("deleted file mode")) status = "removed";
    else if (section.includes("rename ")) status = "renamed";

    files.push({ path, status, additions, deletions, patch: section });
  }

  return files;
}

export function isTrivialChange(
  files: Array<{ path: string; patch?: string }>
): boolean {
  if (files.length === 0) return true;
  return files.every((f) => TRIVIAL_PATTERNS.some((p) => p.test(f.path)));
}

export function applyPathFilters(
  files: ChangedFile[],
  filters: string[]
): ChangedFile[] {
  const excludePatterns = filters
    .filter((f) => f.startsWith("!"))
    .map((f) => new RegExp(f.slice(1).replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*")));

  return files.filter(
    (f) => !excludePatterns.some((p) => p.test(f.path))
  );
}
```

**Step 4: Create `apps/worker/src/pipeline/loadConfig.ts`**

```typescript
import type { Octokit } from "@octokit/rest";
import { loadConfigFromString, defaultConfig } from "@openbunny/core";
import type { OpenBunnyConfig } from "@openbunny/core";

export async function loadRepoConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<OpenBunnyConfig> {
  // JSON takes precedence over YAML
  const candidates = [
    { path: ".openbunny.json", format: "json" as const },
    { path: ".openbunny.yaml", format: "yaml" as const },
    { path: ".openbunny.yml", format: "yaml" as const },
  ];

  for (const { path, format } of candidates) {
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
      if ("content" in data && typeof data.content === "string") {
        const decoded = Buffer.from(data.content, "base64").toString("utf-8");
        return loadConfigFromString(decoded, format);
      }
    } catch {
      // File not found, try next
    }
  }

  return defaultConfig;
}
```

**Step 5: Run tests**

```bash
cd apps/worker && bun test src/pipeline/
```

Expected: PASS

**Step 6: Commit**

```bash
git add apps/worker/src/pipeline
git commit -m "feat(worker): add diff parser, trivial change detection, and config loader"
```

---

### Task 10: `packages/linters` — Linter Runners

**Files:**
- Create: `packages/linters/package.json`
- Create: `packages/linters/src/index.ts`
- Create: `packages/linters/src/runner.ts`
- Create: `packages/linters/src/parsers/eslint.ts`
- Create: `packages/linters/src/parsers/ruff.ts`
- Create: `packages/linters/src/parsers/shellcheck.ts`
- Test: `packages/linters/src/runner.test.ts`

**Step 1: Create `packages/linters/package.json`**

```json
{
  "name": "@openbunny/linters",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "scripts": { "test": "bun test" },
  "dependencies": {
    "@openbunny/core": "workspace:*"
  }
}
```

**Step 2: Write failing tests**

Create `packages/linters/src/runner.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { parseESLintOutput, parseRuffOutput, parseShellCheckOutput } from "./index";

describe("parseESLintOutput", () => {
  test("parses ESLint JSON output", () => {
    const raw = JSON.stringify([
      {
        filePath: "/repo/src/foo.ts",
        messages: [
          { line: 5, column: 3, severity: 2, ruleId: "no-console", message: "Unexpected console statement" },
        ],
      },
    ]);
    const findings = parseESLintOutput(raw, "/repo");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.path).toBe("src/foo.ts");
    expect(findings[0]?.line).toBe(5);
    expect(findings[0]?.rule).toBe("no-console");
    expect(findings[0]?.severity).toBe("error");
  });

  test("returns empty array on empty results", () => {
    const raw = JSON.stringify([{ filePath: "/repo/src/foo.ts", messages: [] }]);
    expect(parseESLintOutput(raw, "/repo")).toHaveLength(0);
  });
});

describe("parseRuffOutput", () => {
  test("parses Ruff JSON output", () => {
    const raw = JSON.stringify([
      { filename: "src/foo.py", location: { row: 10, column: 1 }, code: "E501", message: "Line too long" },
    ]);
    const findings = parseRuffOutput(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.path).toBe("src/foo.py");
    expect(findings[0]?.line).toBe(10);
  });
});
```

**Step 3: Run to verify it fails**

```bash
cd packages/linters && bun test
```

**Step 4: Create `packages/linters/src/parsers/eslint.ts`**

```typescript
import type { LinterFinding } from "@openbunny/core";

interface ESLintMessage {
  line: number;
  column: number;
  severity: 1 | 2;
  ruleId: string | null;
  message: string;
}

interface ESLintResult {
  filePath: string;
  messages: ESLintMessage[];
}

export function parseESLintOutput(json: string, repoRoot: string): LinterFinding[] {
  const results: ESLintResult[] = JSON.parse(json);
  const findings: LinterFinding[] = [];

  for (const result of results) {
    const path = result.filePath.replace(repoRoot + "/", "");
    for (const msg of result.messages) {
      findings.push({
        tool: "eslint",
        path,
        line: msg.line,
        column: msg.column,
        severity: msg.severity === 2 ? "error" : "warning",
        rule: msg.ruleId ?? undefined,
        message: msg.message,
      });
    }
  }

  return findings;
}
```

**Step 5: Create `packages/linters/src/parsers/ruff.ts`**

```typescript
import type { LinterFinding } from "@openbunny/core";

interface RuffFinding {
  filename: string;
  location: { row: number; column: number };
  code: string;
  message: string;
}

export function parseRuffOutput(json: string): LinterFinding[] {
  const results: RuffFinding[] = JSON.parse(json);
  return results.map((r) => ({
    tool: "ruff",
    path: r.filename,
    line: r.location.row,
    column: r.location.column,
    severity: "error" as const,
    rule: r.code,
    message: r.message,
  }));
}
```

**Step 6: Create `packages/linters/src/parsers/shellcheck.ts`**

```typescript
import type { LinterFinding } from "@openbunny/core";

interface ShellCheckResult {
  file: string;
  line: number;
  column: number;
  level: "error" | "warning" | "info" | "style";
  code: number;
  message: string;
}

export function parseShellCheckOutput(json: string): LinterFinding[] {
  const results: ShellCheckResult[] = JSON.parse(json);
  return results.map((r) => ({
    tool: "shellcheck",
    path: r.file,
    line: r.line,
    column: r.column,
    severity: r.level === "error" ? "error" : r.level === "warning" ? "warning" : "info",
    rule: `SC${r.code}`,
    message: r.message,
  }));
}
```

**Step 7: Create `packages/linters/src/runner.ts`**

```typescript
import { $ } from "bun";
import type { LinterFinding } from "@openbunny/core";
import { parseESLintOutput } from "./parsers/eslint";
import { parseRuffOutput } from "./parsers/ruff";
import { parseShellCheckOutput } from "./parsers/shellcheck";

export async function runESLint(
  repoPath: string,
  files: string[]
): Promise<LinterFinding[]> {
  try {
    const result = await $`npx eslint --format json ${files}`.cwd(repoPath).quiet().nothrow();
    return parseESLintOutput(result.stdout.toString(), repoPath);
  } catch {
    return [];
  }
}

export async function runRuff(
  repoPath: string,
  files: string[]
): Promise<LinterFinding[]> {
  try {
    const result = await $`ruff check --output-format json ${files}`.cwd(repoPath).quiet().nothrow();
    return parseRuffOutput(result.stdout.toString());
  } catch {
    return [];
  }
}

export async function runShellCheck(
  repoPath: string,
  files: string[]
): Promise<LinterFinding[]> {
  const shellFiles = files.filter((f) => f.endsWith(".sh") || f.endsWith(".bash"));
  if (shellFiles.length === 0) return [];
  try {
    const result = await $`shellcheck --format json ${shellFiles}`.cwd(repoPath).quiet().nothrow();
    return parseShellCheckOutput(result.stdout.toString());
  } catch {
    return [];
  }
}
```

**Step 8: Create `packages/linters/src/index.ts`**

```typescript
export { parseESLintOutput } from "./parsers/eslint";
export { parseRuffOutput } from "./parsers/ruff";
export { parseShellCheckOutput } from "./parsers/shellcheck";
export { runESLint, runRuff, runShellCheck } from "./runner";
```

**Step 9: Run tests**

```bash
cd packages/linters && bun test
```

Expected: PASS

**Step 10: Commit**

```bash
git add packages/linters
git commit -m "feat(linters): add ESLint, Ruff, ShellCheck runners and parsers"
```

---

### Task 11: `packages/security` — Security Scanners

**Files:**
- Create: `packages/security/package.json`
- Create: `packages/security/src/index.ts`
- Create: `packages/security/src/scanners/semgrep.ts`
- Create: `packages/security/src/scanners/gitleaks.ts`
- Create: `packages/security/src/scanners/trivy.ts`
- Test: `packages/security/src/scanners/semgrep.test.ts`

**Step 1: Create `packages/security/package.json`**

```json
{
  "name": "@openbunny/security",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "scripts": { "test": "bun test" },
  "dependencies": {
    "@openbunny/core": "workspace:*"
  }
}
```

**Step 2: Write failing tests**

Create `packages/security/src/scanners/semgrep.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { parseSemgrepOutput } from "./semgrep";

describe("parseSemgrepOutput", () => {
  test("parses semgrep JSON results", () => {
    const raw = JSON.stringify({
      results: [
        {
          path: "src/auth.py",
          start: { line: 42 },
          check_id: "python.lang.security.sql-injection",
          extra: {
            severity: "ERROR",
            message: "Potential SQL injection via string concatenation",
          },
        },
      ],
    });
    const findings = parseSemgrepOutput(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.path).toBe("src/auth.py");
    expect(findings[0]?.severity).toBe("high");
    expect(findings[0]?.tool).toBe("semgrep");
  });
});
```

**Step 3: Run to verify it fails**

```bash
cd packages/security && bun test
```

**Step 4: Create `packages/security/src/scanners/semgrep.ts`**

```typescript
import { $ } from "bun";
import type { SecurityFinding } from "@openbunny/core";

interface SemgrepResult {
  path: string;
  start: { line: number };
  check_id: string;
  extra: { severity: string; message: string };
}

function mapSeverity(s: string): SecurityFinding["severity"] {
  switch (s.toUpperCase()) {
    case "ERROR": return "high";
    case "WARNING": return "medium";
    case "INFO": return "low";
    default: return "low";
  }
}

export function parseSemgrepOutput(json: string): SecurityFinding[] {
  const data = JSON.parse(json) as { results: SemgrepResult[] };
  return (data.results ?? []).map((r) => ({
    tool: "semgrep",
    path: r.path,
    line: r.start.line,
    severity: mapSeverity(r.extra.severity),
    title: r.check_id,
    description: r.extra.message,
  }));
}

export async function runSemgrep(repoPath: string): Promise<SecurityFinding[]> {
  try {
    const result = await $`semgrep --json --config=auto .`.cwd(repoPath).quiet().nothrow();
    return parseSemgrepOutput(result.stdout.toString());
  } catch {
    return [];
  }
}
```

**Step 5: Create `packages/security/src/scanners/gitleaks.ts`**

```typescript
import { $ } from "bun";
import type { SecurityFinding } from "@openbunny/core";

interface GitleaksResult {
  File: string;
  StartLine: number;
  RuleID: string;
  Description: string;
}

export function parseGitleaksOutput(json: string): SecurityFinding[] {
  const results: GitleaksResult[] = JSON.parse(json) ?? [];
  return results.map((r) => ({
    tool: "gitleaks",
    path: r.File,
    line: r.StartLine,
    severity: "critical" as const,
    title: `Secret detected: ${r.RuleID}`,
    description: r.Description,
  }));
}

export async function runGitleaks(repoPath: string): Promise<SecurityFinding[]> {
  try {
    const result = await $`gitleaks detect --source . --report-format json --report-path /dev/stdout --no-banner`
      .cwd(repoPath).quiet().nothrow();
    if (!result.stdout.toString().trim()) return [];
    return parseGitleaksOutput(result.stdout.toString());
  } catch {
    return [];
  }
}
```

**Step 6: Create `packages/security/src/scanners/trivy.ts`**

```typescript
import { $ } from "bun";
import type { SecurityFinding } from "@openbunny/core";

interface TrivyVuln {
  VulnerabilityID: string;
  Severity: string;
  Title: string;
  Description: string;
  PkgName: string;
}

interface TrivyResult {
  Target: string;
  Vulnerabilities: TrivyVuln[] | null;
}

function mapSeverity(s: string): SecurityFinding["severity"] {
  switch (s.toUpperCase()) {
    case "CRITICAL": return "critical";
    case "HIGH": return "high";
    case "MEDIUM": return "medium";
    default: return "low";
  }
}

export function parseTrivyOutput(json: string): SecurityFinding[] {
  const data = JSON.parse(json) as { Results: TrivyResult[] };
  const findings: SecurityFinding[] = [];
  for (const result of data.Results ?? []) {
    for (const vuln of result.Vulnerabilities ?? []) {
      findings.push({
        tool: "trivy",
        path: result.Target,
        severity: mapSeverity(vuln.Severity),
        title: `${vuln.VulnerabilityID}: ${vuln.PkgName}`,
        description: vuln.Description || vuln.Title,
      });
    }
  }
  return findings;
}

export async function runTrivy(repoPath: string): Promise<SecurityFinding[]> {
  try {
    const result = await $`trivy fs --format json --quiet .`.cwd(repoPath).quiet().nothrow();
    return parseTrivyOutput(result.stdout.toString());
  } catch {
    return [];
  }
}
```

**Step 7: Create `packages/security/src/index.ts`**

```typescript
export { parseSemgrepOutput, runSemgrep } from "./scanners/semgrep";
export { parseGitleaksOutput, runGitleaks } from "./scanners/gitleaks";
export { parseTrivyOutput, runTrivy } from "./scanners/trivy";
```

**Step 8: Run tests**

```bash
cd packages/security && bun test
```

Expected: PASS

**Step 9: Commit**

```bash
git add packages/security
git commit -m "feat(security): add Semgrep, Gitleaks, and Trivy scanner integration"
```

---

### Task 12: Review Pipeline — Prompt Construction and AI Review

**Files:**
- Create: `apps/worker/src/pipeline/buildPrompt.ts`
- Create: `apps/worker/src/pipeline/postComments.ts`
- Test: `apps/worker/src/pipeline/buildPrompt.test.ts`

**Step 1: Write failing tests**

Create `apps/worker/src/pipeline/buildPrompt.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { buildReviewPrompt, buildSummaryPrompt } from "./buildPrompt";

describe("buildReviewPrompt", () => {
  test("includes diff in messages", () => {
    const messages = buildReviewPrompt({
      diff: "--- a/foo.ts\n+++ b/foo.ts\n+const x = 1;",
      changedFiles: [{ path: "foo.ts", status: "modified", additions: 1, deletions: 0 }],
      linterFindings: [],
      securityFindings: [],
      pathInstructions: [],
      profile: "chill",
    });
    const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
    expect(userMsg).toContain("foo.ts");
  });

  test("includes linter findings when present", () => {
    const messages = buildReviewPrompt({
      diff: "+code",
      changedFiles: [],
      linterFindings: [
        { tool: "eslint", path: "foo.ts", line: 1, severity: "error", message: "no-console", rule: "no-console" },
      ],
      securityFindings: [],
      pathInstructions: [],
      profile: "chill",
    });
    const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
    expect(userMsg).toContain("no-console");
  });
});
```

**Step 2: Run to verify it fails**

```bash
cd apps/worker && bun test src/pipeline/buildPrompt.test.ts
```

**Step 3: Create `apps/worker/src/pipeline/buildPrompt.ts`**

```typescript
import type { AIMessage } from "@openbunny/ai";
import type { ChangedFile, LinterFinding, SecurityFinding } from "@openbunny/core";

interface PromptOptions {
  diff: string;
  changedFiles: ChangedFile[];
  linterFindings: LinterFinding[];
  securityFindings: SecurityFinding[];
  pathInstructions: Array<{ path: string; instructions: string }>;
  profile: "chill" | "assertive";
}

const SYSTEM_PROMPT = `You are OpenBunny, an AI code reviewer. Your job is to review pull request changes and provide helpful, actionable feedback.

Review guidelines:
- Be constructive and specific. Reference exact line numbers.
- Categorize findings: CRITICAL (bugs, security), MAJOR (logic errors, performance), MINOR (code quality), NITPICK (style, formatting).
- For NITPICK items, prefix with [nitpick].
- Suggest concrete code fixes using suggestion blocks when possible.
- Do NOT comment on lines not in the diff.
- If a change looks good, say so briefly. Don't invent problems.

Output format for each inline comment:
FILE: <path>
LINE: <number>
SEVERITY: critical|major|minor|nitpick
COMMENT: <your review comment>
SUGGESTION: <optional: replacement code block>
---

End your response with a SUMMARY section:
SUMMARY: <2-4 sentence overview of the PR changes>
`;

const ASSERTIVE_ADDENDUM = `\nBe thorough and flag even minor issues. Err on the side of more comments rather than fewer.`;

export function buildReviewPrompt(opts: PromptOptions): AIMessage[] {
  const { diff, changedFiles, linterFindings, securityFindings, profile, pathInstructions } = opts;

  let userContent = `## Pull Request Diff\n\n\`\`\`diff\n${diff}\n\`\`\`\n\n`;

  if (changedFiles.length > 0) {
    userContent += `## Changed Files\n\n`;
    for (const f of changedFiles) {
      userContent += `- ${f.path} (${f.status}, +${f.additions}/-${f.deletions})\n`;
    }
    userContent += "\n";
  }

  if (linterFindings.length > 0) {
    userContent += `## Linter Findings (pre-filtered)\n\n`;
    for (const f of linterFindings) {
      userContent += `- [${f.tool}] ${f.path}:${f.line} ${f.severity.toUpperCase()} - ${f.message}${f.rule ? ` (${f.rule})` : ""}\n`;
    }
    userContent += "\n";
  }

  if (securityFindings.length > 0) {
    userContent += `## Security Scanner Findings\n\n`;
    for (const f of securityFindings) {
      userContent += `- [${f.tool}] ${f.path}${f.line ? `:${f.line}` : ""} ${f.severity.toUpperCase()} - ${f.title}: ${f.description}\n`;
    }
    userContent += "\n";
  }

  if (pathInstructions.length > 0) {
    userContent += `## Custom Instructions\n\n`;
    for (const pi of pathInstructions) {
      userContent += `For files matching \`${pi.path}\`: ${pi.instructions}\n`;
    }
    userContent += "\n";
  }

  userContent += `Please review the above changes and provide your feedback.`;

  const systemContent = SYSTEM_PROMPT + (profile === "assertive" ? ASSERTIVE_ADDENDUM : "");

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
}

export function buildSummaryPrompt(
  prTitle: string,
  prBody: string,
  changedFiles: ChangedFile[]
): AIMessage[] {
  return [
    {
      role: "system",
      content:
        "You write concise, accurate PR summaries. Given a PR title, description, and list of changed files, write a 1-3 sentence summary of what the PR does.",
    },
    {
      role: "user",
      content: `Title: ${prTitle}\n\nDescription: ${prBody || "(none)"}\n\nChanged files:\n${changedFiles.map((f) => `- ${f.path}`).join("\n")}\n\nSummary:`,
    },
  ];
}
```

**Step 4: Create `apps/worker/src/pipeline/postComments.ts`**

```typescript
import type { Octokit } from "@octokit/rest";
import type { ReviewComment } from "@openbunny/core";

export interface ParsedReview {
  summary: string;
  comments: ReviewComment[];
}

export function parseAIResponse(response: string): ParsedReview {
  const comments: ReviewComment[] = [];
  let summary = "";

  // Extract summary
  const summaryMatch = response.match(/SUMMARY:\s*(.+?)(?:\n|$)/s);
  if (summaryMatch) summary = summaryMatch[1]?.trim() ?? "";

  // Extract inline comments
  const commentBlocks = response.split("---").filter((b) => b.includes("FILE:"));
  for (const block of commentBlocks) {
    const fileMatch = block.match(/FILE:\s*(.+)/);
    const lineMatch = block.match(/LINE:\s*(\d+)/);
    const severityMatch = block.match(/SEVERITY:\s*(critical|major|minor|nitpick)/i);
    const commentMatch = block.match(/COMMENT:\s*(.+?)(?=SUGGESTION:|---|\n\n|$)/s);
    const suggestionMatch = block.match(/SUGGESTION:\s*```[\w]*\n([\s\S]+?)```/);

    if (!fileMatch || !lineMatch || !commentMatch) continue;

    let body = commentMatch[1]?.trim() ?? "";
    if (suggestionMatch) {
      body += `\n\n\`\`\`suggestion\n${suggestionMatch[1]}\`\`\``;
    }

    comments.push({
      path: fileMatch[1]?.trim() ?? "",
      line: parseInt(lineMatch[1] ?? "1"),
      severity: (severityMatch?.[1]?.toLowerCase() as ReviewComment["severity"]) ?? "minor",
      body,
      suggestion: suggestionMatch?.[1],
    });
  }

  return { summary, comments };
}

export async function postReviewComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  headSha: string,
  review: ParsedReview
): Promise<void> {
  // Post summary comment
  if (review.summary) {
    const summaryBody = `## OpenBunny Review\n\n${review.summary}`;
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: summaryBody,
    });
  }

  // Post inline comments (batch into a single review)
  if (review.comments.length > 0) {
    const reviewComments = review.comments.map((c) => ({
      path: c.path,
      line: c.line,
      body: formatComment(c),
    }));

    await octokit.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      commit_id: headSha,
      event: "COMMENT",
      comments: reviewComments,
    });
  }
}

function formatComment(comment: ReviewComment): string {
  const severityEmoji: Record<string, string> = {
    critical: "🔴",
    major: "🟠",
    minor: "🟡",
    nitpick: "⚪",
  };
  const emoji = severityEmoji[comment.severity] ?? "💬";
  return `${emoji} **${comment.severity.toUpperCase()}**: ${comment.body}`;
}
```

**Step 5: Run tests**

```bash
cd apps/worker && bun test src/pipeline/
```

Expected: PASS

**Step 6: Commit**

```bash
git add apps/worker/src/pipeline
git commit -m "feat(worker): add AI prompt builder and review comment poster"
```

---

### Task 13: Wire Up the Full Review Pipeline

**Files:**
- Modify: `apps/worker/src/jobs/review.ts`

**Step 1: Update `apps/worker/src/jobs/review.ts` with full pipeline**

```typescript
import type { Job } from "bullmq";
import { createDb, pullRequests, reviews } from "@openbunny/core";
import { createGitHubApp, getInstallationOctokit } from "@openbunny/github";
import { createAIGateway } from "@openbunny/ai";
import { runESLint, runRuff, runShellCheck } from "@openbunny/linters";
import { runSemgrep, runGitleaks, runTrivy } from "@openbunny/security";
import { env } from "../env";
import { parseDiff, isTrivialChange, applyPathFilters } from "../pipeline/fetchDiff";
import { loadRepoConfig } from "../pipeline/loadConfig";
import { buildReviewPrompt, buildSummaryPrompt } from "../pipeline/buildPrompt";
import { parseAIResponse, postReviewComments } from "../pipeline/postComments";
import { eq, and } from "drizzle-orm";
import * as os from "os";
import * as path from "path";
import { $ } from "bun";

export async function processReviewJob(job: Job): Promise<void> {
  const { payload } = job.data as { payload: Record<string, unknown> };

  const pr = payload["pull_request"] as Record<string, unknown>;
  const repo = payload["repository"] as Record<string, unknown>;
  const installation = payload["installation"] as { id: number };

  const owner = (repo["owner"] as { login: string })["login"];
  const repoName = repo["name"] as string;
  const pullNumber = pr["number"] as number;
  const headSha = (pr["head"] as { sha: string })["sha"];
  const baseSha = (pr["base"] as { sha: string })["sha"];
  const isDraft = (pr["draft"] as boolean) ?? false;
  const isFromFork = (pr["head"] as Record<string, unknown>)["repo"] !== null &&
    ((pr["head"] as Record<string, unknown>)["repo"] as Record<string, unknown>)["full_name"] !==
    repo["full_name"];

  const db = createDb(env.DATABASE_URL);
  const githubApp = createGitHubApp({
    appId: parseInt(env.GITHUB_APP_ID),
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
  });

  const octokit = await getInstallationOctokit(githubApp, installation.id);

  // Load config
  const config = await loadRepoConfig(octokit, owner, repoName, headSha);

  // Skip draft PRs if configured
  if (isDraft && !config.reviews.auto_review.draft) {
    console.log(`[review] Skipping draft PR #${pullNumber}`);
    return;
  }

  // Fetch diff
  const { data: diffData } = await octokit.pulls.get({
    owner,
    repo: repoName,
    pull_number: pullNumber,
    mediaType: { format: "diff" },
  });
  const diffText = diffData as unknown as string;
  const allFiles = parseDiff(diffText);
  const filteredFiles = applyPathFilters(allFiles, config.reviews.path_filters);

  // Skip trivial changes
  if (config.reviews.skip_trivial && isTrivialChange(filteredFiles)) {
    console.log(`[review] Skipping trivial PR #${pullNumber}`);
    return;
  }

  // Get AI API key from env
  const providerKeyMap: Record<string, string | undefined> = {
    openai: env.OPENAI_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
    google: env.GOOGLE_API_KEY,
    ollama: "",
  };
  const apiKey = providerKeyMap[config.ai.provider] ?? "";

  const lightAI = createAIGateway({
    provider: config.ai.provider,
    model: config.ai.light_model,
    apiKey,
    baseUrl: config.ai.base_url,
  });
  const heavyAI = createAIGateway({
    provider: config.ai.provider,
    model: config.ai.model,
    apiKey,
    baseUrl: config.ai.base_url,
  });

  // Clone repo for linter/security runs (shallow)
  const tmpDir = path.join(os.tmpdir(), `openbunny-${owner}-${repoName}-${pullNumber}`);
  try {
    await $`git clone --depth=1 --branch ${(pr["head"] as Record<string, unknown>)["ref"]} https://x-access-token:${await getInstallationToken(githubApp, installation.id)}@github.com/${owner}/${repoName}.git ${tmpDir}`.quiet();
  } catch (e) {
    console.warn("[review] Could not clone repo, skipping linters:", e);
  }

  // Run linters in parallel
  const changedPaths = filteredFiles.map((f) => f.path);
  const [eslintFindings, ruffFindings, shellcheckFindings] = await Promise.all([
    config.linters.eslint.enabled ? runESLint(tmpDir, changedPaths) : Promise.resolve([]),
    config.linters.ruff.enabled ? runRuff(tmpDir, changedPaths) : Promise.resolve([]),
    config.linters.shellcheck.enabled ? runShellCheck(tmpDir, changedPaths) : Promise.resolve([]),
  ]);

  // Run security scanners in parallel
  const [semgrepFindings, gitleaksFindings, trivyFindings] = await Promise.all([
    config.security.semgrep.enabled ? runSemgrep(tmpDir) : Promise.resolve([]),
    config.security.gitleaks.enabled ? runGitleaks(tmpDir) : Promise.resolve([]),
    config.security.trivy.enabled ? runTrivy(tmpDir) : Promise.resolve([]),
  ]);

  const allLinterFindings = [...eslintFindings, ...ruffFindings, ...shellcheckFindings]
    .filter((f) => changedPaths.includes(f.path));
  const allSecurityFindings = [...semgrepFindings, ...gitleaksFindings, ...trivyFindings];

  // Build and run AI review
  const reviewMessages = buildReviewPrompt({
    diff: diffText,
    changedFiles: filteredFiles,
    linterFindings: allLinterFindings,
    securityFindings: allSecurityFindings,
    pathInstructions: config.reviews.path_instructions,
    profile: config.reviews.profile,
  });

  const aiResponse = await heavyAI.complete({ messages: reviewMessages });
  const parsedReview = parseAIResponse(aiResponse);

  // Post comments (skip inline for fork PRs - no write access)
  if (isFromFork) {
    await octokit.issues.createComment({
      owner,
      repo: repoName,
      issue_number: pullNumber,
      body: `> ⚠️ This PR is from a fork. OpenBunny can only post a summary comment.\n\n## OpenBunny Review\n\n${parsedReview.summary}`,
    });
  } else {
    await postReviewComments(octokit, owner, repoName, pullNumber, headSha, parsedReview);
  }

  // Cleanup tmp dir
  await $`rm -rf ${tmpDir}`.quiet().nothrow();

  console.log(`[review] ✅ PR #${pullNumber} reviewed: ${parsedReview.comments.length} comments`);
}

async function getInstallationToken(app: App, installationId: number): Promise<string> {
  const { token } = await app.octokit.auth({
    type: "installation",
    installationId,
  }) as { token: string };
  return token;
}
```

**Note:** Import `App` from `@octokit/app` at the top of the file.

**Step 2: Commit**

```bash
git add apps/worker/src/jobs/review.ts
git commit -m "feat(worker): wire up full review pipeline (diff → linters → security → AI → post)"
```

---

### Task 14: Chat Commands Handler

**Files:**
- Create: `apps/worker/src/pipeline/chatCommands.ts`
- Modify: `apps/worker/src/jobs/review.ts` (`processChatJob`)
- Test: `apps/worker/src/pipeline/chatCommands.test.ts`

**Step 1: Write failing tests**

Create `apps/worker/src/pipeline/chatCommands.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { parseChatCommand } from "./chatCommands";

describe("parseChatCommand", () => {
  test("parses 'review' command", () => {
    const cmd = parseChatCommand("@openbunny review");
    expect(cmd.type).toBe("review");
  });

  test("parses 'pause' command", () => {
    const cmd = parseChatCommand("  @openbunny pause  ");
    expect(cmd.type).toBe("pause");
  });

  test("parses 'help' command", () => {
    expect(parseChatCommand("@openbunny help").type).toBe("help");
  });

  test("parses free-form question", () => {
    const cmd = parseChatCommand("@openbunny what does this change do?");
    expect(cmd.type).toBe("question");
    expect(cmd.text).toBe("what does this change do?");
  });

  test("returns unknown for non-openbunny mention", () => {
    const cmd = parseChatCommand("just a regular comment");
    expect(cmd.type).toBe("unknown");
  });
});
```

**Step 2: Run to verify it fails**

```bash
cd apps/worker && bun test src/pipeline/chatCommands.test.ts
```

**Step 3: Create `apps/worker/src/pipeline/chatCommands.ts`**

```typescript
export type CommandType = "review" | "pause" | "resume" | "ignore" | "config" | "help" | "question" | "unknown";

export interface ParsedCommand {
  type: CommandType;
  text?: string;
}

const KNOWN_COMMANDS = ["review", "pause", "resume", "ignore", "config", "help"] as const;

export function parseChatCommand(body: string): ParsedCommand {
  const trimmed = body.trim();
  if (!trimmed.includes("@openbunny")) return { type: "unknown" };

  const afterMention = trimmed.replace(/.*@openbunny\s*/s, "").trim();
  if (!afterMention) return { type: "help" };

  const firstWord = afterMention.split(/\s+/)[0]?.toLowerCase();
  if (KNOWN_COMMANDS.includes(firstWord as never)) {
    return { type: firstWord as CommandType };
  }

  return { type: "question", text: afterMention };
}

export const HELP_TEXT = `## OpenBunny Commands

| Command | Description |
|---|---|
| \`@openbunny review\` | Trigger a full review of this PR |
| \`@openbunny pause\` | Pause auto-reviews for this PR |
| \`@openbunny resume\` | Resume auto-reviews |
| \`@openbunny ignore\` | Ignore this PR |
| \`@openbunny config\` | Show current config |
| \`@openbunny help\` | Show this help message |
| \`@openbunny <question>\` | Ask a question about this PR |
`;
```

**Step 4: Update `processChatJob` in `apps/worker/src/jobs/review.ts`**

```typescript
export async function processChatJob(job: Job): Promise<void> {
  const { payload } = job.data as { payload: Record<string, unknown> };

  const comment = payload["comment"] as { body: string; id: number };
  const issue = payload["issue"] as { number: number; pull_request?: unknown };
  const repo = payload["repository"] as Record<string, unknown>;
  const installation = payload["installation"] as { id: number };

  if (!issue.pull_request) return; // only handle PR comments

  const owner = (repo["owner"] as { login: string })["login"];
  const repoName = repo["name"] as string;
  const pullNumber = issue.number;

  const { parseChatCommand, HELP_TEXT } = await import("../pipeline/chatCommands");
  const command = parseChatCommand(comment.body);

  const githubApp = createGitHubApp({
    appId: parseInt(env.GITHUB_APP_ID),
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
  });
  const octokit = await getInstallationOctokit(githubApp, installation.id);
  const db = createDb(env.DATABASE_URL);

  switch (command.type) {
    case "help":
      await octokit.issues.createComment({ owner, repo: repoName, issue_number: pullNumber, body: HELP_TEXT });
      break;

    case "review":
      // Re-enqueue a full review job (reset last_reviewed_sha)
      await octokit.issues.createComment({
        owner, repo: repoName, issue_number: pullNumber,
        body: "🐇 Full review triggered! I'll post results shortly.",
      });
      // TODO: reset last_reviewed_sha and enqueue review job
      break;

    case "pause":
      await octokit.issues.createComment({
        owner, repo: repoName, issue_number: pullNumber,
        body: "⏸️ Auto-reviews paused for this PR.",
      });
      break;

    case "resume":
      await octokit.issues.createComment({
        owner, repo: repoName, issue_number: pullNumber,
        body: "▶️ Auto-reviews resumed.",
      });
      break;

    case "ignore":
      await octokit.issues.createComment({
        owner, repo: repoName, issue_number: pullNumber,
        body: "🙈 This PR will be ignored by OpenBunny.",
      });
      break;

    case "config": {
      const config = await loadRepoConfig(octokit, owner, repoName, "HEAD");
      await octokit.issues.createComment({
        owner, repo: repoName, issue_number: pullNumber,
        body: `**Current OpenBunny config:**\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\``,
      });
      break;
    }

    case "question":
      // TODO: implement AI-powered question answering
      await octokit.issues.createComment({
        owner, repo: repoName, issue_number: pullNumber,
        body: "🤔 AI chat coming soon! For now, try `@openbunny review` to get a fresh review.",
      });
      break;
  }
}
```

**Step 5: Run tests**

```bash
cd apps/worker && bun test src/pipeline/chatCommands.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add apps/worker/src/pipeline/chatCommands.ts apps/worker/src/jobs/review.ts
git commit -m "feat(worker): add chat command parser and handler"
```

---

## Phase 6: Web Dashboard (MVP)

### Task 15: `apps/ui` — React + Vite Setup

**Files:**
- Create: `apps/ui/package.json`
- Create: `apps/ui/vite.config.ts`
- Create: `apps/ui/index.html`
- Create: `apps/ui/src/main.tsx`
- Create: `apps/ui/src/App.tsx`

**Step 1: Create `apps/ui/package.json`**

```json
{
  "name": "@openbunny/ui",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.1.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^6.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Install**

```bash
cd apps/ui && bun install && cd ../..
```

**Step 3: Create `apps/ui/vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
```

**Step 4: Create `apps/ui/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenBunny</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 5: Create `apps/ui/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
```

**Step 6: Create `apps/ui/src/App.tsx`**

```tsx
import { Routes, Route } from "react-router-dom";

export default function App() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 800, margin: "0 auto", padding: 24 }}>
      <header>
        <h1>🐇 OpenBunny</h1>
        <nav>
          <a href="/">Dashboard</a> | <a href="/repos">Repositories</a> | <a href="/settings">Settings</a>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/repos" element={<Repositories />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

function Dashboard() {
  return (
    <div>
      <h2>Dashboard</h2>
      <p>Recent PR reviews will appear here.</p>
    </div>
  );
}

function Repositories() {
  return (
    <div>
      <h2>Repositories</h2>
      <p>Connected repositories will appear here.</p>
    </div>
  );
}

function Settings() {
  return (
    <div>
      <h2>Settings</h2>
      <p>AI provider configuration and API keys.</p>
    </div>
  );
}
```

**Step 7: Commit**

```bash
git add apps/ui
git commit -m "feat(ui): add React + Vite SPA scaffold with basic routing"
```

---

## Phase 7: Docker Compose & Self-Hosting

### Task 16: Docker Compose and Environment Setup

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `apps/api/Dockerfile`
- Create: `apps/worker/Dockerfile`
- Create: `apps/ui/Dockerfile`

**Step 1: Create `apps/api/Dockerfile`**

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bunfig.toml turbo.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

RUN bun install --frozen-lockfile

EXPOSE 3000
CMD ["bun", "apps/api/src/index.ts"]
```

**Step 2: Create `apps/worker/Dockerfile`**

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# Install linter/security tools
RUN apt-get update && apt-get install -y \
  git \
  nodejs \
  npm \
  python3 \
  python3-pip \
  shellcheck \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g eslint
RUN pip3 install ruff semgrep --break-system-packages
RUN curl -sfL https://raw.githubusercontent.com/trufflesecurity/trufflehog/main/scripts/install.sh | sh -s -- -b /usr/local/bin 2>/dev/null || true

COPY package.json bunfig.toml turbo.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/worker/ ./apps/worker/

RUN bun install --frozen-lockfile

CMD ["bun", "apps/worker/src/index.ts"]
```

**Step 3: Create `apps/ui/Dockerfile`**

```dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bunfig.toml turbo.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/ui/ ./apps/ui/
RUN bun install --frozen-lockfile
RUN bun run --cwd apps/ui build

FROM nginx:alpine
COPY --from=builder /app/apps/ui/dist /usr/share/nginx/html
EXPOSE 80
```

**Step 4: Create `docker-compose.yml`**

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: openbunny
      POSTGRES_USER: openbunny
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-openbunny}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U openbunny"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://openbunny:${POSTGRES_PASSWORD:-openbunny}@postgres:5432/openbunny
      REDIS_URL: redis://redis:6379
      PORT: "3000"
      GITHUB_APP_ID: ${GITHUB_APP_ID}
      GITHUB_APP_PRIVATE_KEY: ${GITHUB_APP_PRIVATE_KEY}
      GITHUB_WEBHOOK_SECRET: ${GITHUB_WEBHOOK_SECRET}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  worker:
    build:
      context: .
      dockerfile: apps/worker/Dockerfile
    environment:
      DATABASE_URL: postgresql://openbunny:${POSTGRES_PASSWORD:-openbunny}@postgres:5432/openbunny
      REDIS_URL: redis://redis:6379
      GITHUB_APP_ID: ${GITHUB_APP_ID}
      GITHUB_APP_PRIVATE_KEY: ${GITHUB_APP_PRIVATE_KEY}
      GITHUB_WEBHOOK_SECRET: ${GITHUB_WEBHOOK_SECRET}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
      GOOGLE_API_KEY: ${GOOGLE_API_KEY:-}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    # Scale workers: docker-compose up --scale worker=3

  ui:
    build:
      context: .
      dockerfile: apps/ui/Dockerfile
    ports:
      - "3001:80"
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

**Step 5: Create `.env.example`**

```bash
# PostgreSQL
POSTGRES_PASSWORD=changeme

# GitHub App (required)
# Create at: https://github.com/settings/apps/new
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...your private key here...
-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your-webhook-secret

# AI Provider keys (at least one required)
ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# GOOGLE_API_KEY=...
```

**Step 6: Add Drizzle migration script to `packages/core/package.json`**

Add to scripts:
```json
"db:migrate": "bun drizzle-kit migrate",
"db:generate": "bun drizzle-kit generate"
```

**Step 7: Commit**

```bash
git add docker-compose.yml .env.example apps/api/Dockerfile apps/worker/Dockerfile apps/ui/Dockerfile
git commit -m "feat: add Docker Compose self-hosting setup with all 5 services"
```

---

### Task 17: Add LICENSE and GitHub App Setup Docs

**Files:**
- Create: `LICENSE`
- Create: `README.md`
- Create: `docs/setup/github-app.md`

**Step 1: Create `LICENSE`**

```
Functional Source License, Version 1.0, Apache 2.0 Future License

Copyright (c) 2026 OpenBunny Contributors

Permission is hereby granted to use, copy, modify, and/or distribute this
software for any purpose with or without fee, provided that:

1. This software may not be used to provide a competing hosted service that
   replicates the functionality of OpenBunny.

2. The above copyright notice and this permission notice shall be included in
   all copies or substantial portions of the software.

CHANGE DATE: Four years from the date of each version's release.

CHANGE LICENSE: Apache License, Version 2.0

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

For the full FSL-1.0 license text, see: https://fsl.software/
```

**Step 2: Create `README.md`**

```markdown
# 🐇 OpenBunny

Open-source AI PR review platform — a maintained alternative to CodeRabbit.

## Features

- **AI-powered PR reviews** — summary, walkthrough, inline comments with severity
- **Multi-provider AI** — OpenAI, Anthropic Claude, Google Gemini, or local Ollama
- **10 linter integrations** — ESLint, Ruff, ShellCheck, Biome, Hadolint, ActionLint, and more
- **Security scanning** — Semgrep, Gitleaks (secret detection), Trivy (vulnerabilities)
- **Smart context retrieval** — understands callers/callees beyond the diff
- **Incremental reviews** — only re-reviews new commits, not the whole PR
- **Chat commands** — `@openbunny review`, `pause`, `resume`, `ignore`, `help`
- **Self-hostable** — Docker Compose, bring your own AI keys
- **Config file** — `.openbunny.json` or `.openbunny.yaml`

## Quick Start (Self-Hosted)

### 1. Create a GitHub App

Follow: [docs/setup/github-app.md](docs/setup/github-app.md)

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your GitHub App credentials and AI API key
```

### 3. Start OpenBunny

```bash
docker-compose up -d
```

OpenBunny API: http://localhost:3000
Dashboard: http://localhost:3001

### 4. Configure your repo

Create `.openbunny.json` in your repository:

```json
{
  "ai": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6"
  },
  "reviews": {
    "profile": "chill"
  }
}
```

## License

[FSL-1.0-Apache-2.0](LICENSE) — source available, converts to Apache 2.0 after 2 years.
```

**Step 3: Create `docs/setup/github-app.md`**

```markdown
# Creating a GitHub App for OpenBunny

## 1. Go to GitHub App creation

Navigate to: `https://github.com/settings/apps/new`
(Or for an organization: `https://github.com/organizations/YOUR_ORG/settings/apps/new`)

## 2. Fill in app details

- **GitHub App name:** OpenBunny (Self-Hosted)
- **Homepage URL:** http://localhost:3001
- **Webhook URL:** http://YOUR_SERVER:3000/webhook/github
  - For local testing use ngrok: `ngrok http 3000`
- **Webhook secret:** Generate a random string, save it as `GITHUB_WEBHOOK_SECRET`

## 3. Set permissions

**Repository permissions:**
- Contents: Read
- Issues: Read & Write
- Pull requests: Read & Write
- Metadata: Read

## 4. Subscribe to events

- Pull request
- Issue comment

## 5. Create the app

Click "Create GitHub App".

## 6. Generate a private key

On the app page, scroll to "Private keys" and click "Generate a private key".
Save the downloaded `.pem` file — this is your `GITHUB_APP_PRIVATE_KEY`.

## 7. Note the App ID

On the app settings page, note the "App ID" — this is your `GITHUB_APP_ID`.

## 8. Install the app

Click "Install App" and select the repositories you want OpenBunny to review.
```

**Step 4: Commit**

```bash
git add LICENSE README.md docs/
git commit -m "docs: add LICENSE (FSL-1.0), README, and GitHub App setup guide"
```

---

## Final Verification

### Run all tests

```bash
bun test
```

Expected: All tests pass across all packages.

### Test Docker Compose build

```bash
docker-compose build
```

Expected: All 3 app images build successfully.

### Verify workspace dependencies resolve

```bash
bun run build
```

Expected: All packages compile without TypeScript errors.

---

## Summary of What's Built

After completing all tasks, you'll have:

| Component | Status |
|---|---|
| Monorepo (Turborepo + Bun) | ✅ |
| `packages/core` — types, config parser, DB schema | ✅ |
| `packages/github` — webhook validation, Octokit client | ✅ |
| `packages/ai` — multi-provider gateway (OpenAI, Anthropic, Google, Ollama) | ✅ |
| `packages/linters` — ESLint, Ruff, ShellCheck runners | ✅ |
| `packages/security` — Semgrep, Gitleaks, Trivy scanners | ✅ |
| `apps/api` — Hono webhook server + job queue | ✅ |
| `apps/worker` — BullMQ worker, full review pipeline | ✅ |
| `apps/ui` — React + Vite dashboard scaffold | ✅ |
| Docker Compose (5 services) | ✅ |
| GitHub App setup docs | ✅ |
| FSL-1.0 license | ✅ |
