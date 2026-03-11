import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { Queue } from "bullmq";
import { parseEnv } from "./env";
import { db } from "../lib/db";
import { decrypt } from "../lib/crypto";
import { healthRouter } from "./routes/health";
import { createWebhookRouter } from "./routes/webhook";
import { createSetupRouter, createGitHubRouter } from "./routes/setup";
import { createReposRouter } from "./routes/repos";
import { createSettingsRouter } from "./routes/settings";
import { auth } from "./auth";

const env = parseEnv();

const app = new Hono();

app.use("*", logger());
app.use(
  "/api/*",
  cors({
    origin: env.BASE_URL,
    credentials: true,
  })
);

// Better Auth handler
app.on(["GET", "POST"], "/api/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

// Health
app.route("/api/health", healthRouter);

// Setup + GitHub manifest flow
const routerOpts = { db, baseUrl: env.BASE_URL, onWebhookSecretLoaded: mountWebhookRouter };
app.route("/api/setup", createSetupRouter(routerOpts));
app.route("/api/github", createGitHubRouter(routerOpts));

// Repos + Settings (auth-gated in a real deployment — middleware can be added later)
app.route("/api/repos", createReposRouter(db));
app.route("/api/settings", createSettingsRouter(db));

// BullMQ review queue
const reviewQueue = new Queue("review", {
  connection: { url: env.REDIS_URL },
});

// Webhook router — conditionally mounted if GitHub App is configured
// Gap 2: load webhook secret from app_config DB at startup (not env var)
async function mountWebhookRouter(webhookSecret: string) {
  app.route(
    "/api/webhooks",
    createWebhookRouter({ webhookSecret, reviewQueue, db })
  );
}

async function start() {
  // Load webhook secret from DB if available
  const appCfg = await db.appConfig.findFirst();
  if (appCfg?.githubWebhookSecretEncrypted) {
    const webhookSecret = decrypt(appCfg.githubWebhookSecretEncrypted);
    await mountWebhookRouter(webhookSecret);
    console.log("Webhook route mounted from app_config.");
  } else {
    console.log("No GitHub App configured — webhook route not mounted.");
  }

  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`OpenBunny API running on http://localhost:${info.port}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

export default app;
