import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { auth } from "../auth";
import { encrypt } from "../../lib/crypto";

interface SetupRouterOptions {
  db: PrismaClient;
  baseUrl: string;
  onWebhookSecretLoaded?: (secret: string) => void;
}

/** Routes mounted at /api/setup */
export function createSetupRouter({ db, baseUrl, onWebhookSecretLoaded }: SetupRouterOptions) {
  const router = new Hono();

  // GET /api/setup/status
  router.get("/status", async (c) => {
    const cfg = await db.appConfig.findFirst();
    return c.json({
      setupComplete: cfg?.setupComplete ?? false,
      hasGitHubApp: !!cfg?.githubAppId,
      hasAiKey: !!cfg?.aiApiKeyEncrypted,
    });
  });

  // POST /api/setup/admin — Step 1: create admin account
  router.post(
    "/admin",
    zValidator(
      "json",
      z.object({ email: z.string().email(), password: z.string().min(8) })
    ),
    async (c) => {
      const { email, password } = c.req.valid("json");

      const cfg = await db.appConfig.findFirst();
      if (cfg?.setupComplete) {
        return c.json({ error: "Setup already complete" }, 400);
      }

      await auth.api.signUpEmail({
        body: { email, password, name: "Admin" },
        headers: c.req.raw.headers,
      });

      await db.appConfig.upsert({
        where: { id: "singleton" },
        create: { id: "singleton" },
        update: {},
      });

      return c.json({ ok: true });
    }
  );

  return router;
}

/** Routes mounted at /api/github */
export function createGitHubRouter({ db, baseUrl, onWebhookSecretLoaded }: SetupRouterOptions) {
  const router = new Hono();

  // GET /api/github/manifest — return manifest JSON for App creation
  router.get("/manifest", (c) => {
    const manifest = {
      name: "OpenBunny",
      url: baseUrl,
      hook_attributes: { url: `${baseUrl}/api/webhooks/github` },
      redirect_url: `${baseUrl}/api/github/manifest-callback`,
      callback_urls: [`${baseUrl}/api/github/manifest-callback`],
      public: false,
      default_permissions: {
        pull_requests: "write",
        contents: "read",
        metadata: "read",
      },
      default_events: ["pull_request", "installation", "installation_repositories"],
    };
    return c.json(manifest);
  });

  // GET /api/github/manifest-callback — Step 2: exchange code for credentials
  router.get("/manifest-callback", async (c) => {
    const code = c.req.query("code");
    if (!code) return c.json({ error: "Missing code" }, 400);

    const res = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json" },
    });

    if (!res.ok) {
      return c.json({ error: "GitHub manifest exchange failed" }, 502);
    }

    const app = (await res.json()) as {
      id: number;
      slug: string;
      client_id: string;
      client_secret: string;
      pem: string;
      webhook_secret: string;
    };

    await db.appConfig.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        githubAppId: String(app.id),
        githubAppSlug: app.slug,
        githubClientIdEncrypted: encrypt(app.client_id),
        githubClientSecretEncrypted: encrypt(app.client_secret),
        githubPrivateKeyEncrypted: encrypt(app.pem),
        githubWebhookSecretEncrypted: encrypt(app.webhook_secret),
      },
      update: {
        githubAppId: String(app.id),
        githubAppSlug: app.slug,
        githubClientIdEncrypted: encrypt(app.client_id),
        githubClientSecretEncrypted: encrypt(app.client_secret),
        githubPrivateKeyEncrypted: encrypt(app.pem),
        githubWebhookSecretEncrypted: encrypt(app.webhook_secret),
      },
    });

    onWebhookSecretLoaded?.(app.webhook_secret);

    return c.redirect(`https://github.com/apps/${app.slug}/installations/new`);
  });

  // GET /api/github/install-callback — Step 3: after GitHub App installed on repos
  router.get("/install-callback", async (c) => {
    await db.appConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", setupComplete: true },
      update: { setupComplete: true },
    });

    return c.redirect("/");
  });

  return router;
}
