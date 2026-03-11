import { Hono } from "hono";
import type { Queue } from "bullmq";
import type { PrismaClient } from "@prisma/client";
import { verifyWebhookSignature } from "../../lib/github";

interface WebhookRouterOptions {
  webhookSecret: string;
  reviewQueue: Queue;
  db: PrismaClient;
}

export function createWebhookRouter({ webhookSecret, reviewQueue, db }: WebhookRouterOptions) {
  const router = new Hono();

  router.post("/github", async (c) => {
    const signature = c.req.header("X-Hub-Signature-256") ?? null;
    const event = c.req.header("X-GitHub-Event");
    const body = await c.req.text();

    try {
      verifyWebhookSignature(body, signature, webhookSecret);
    } catch {
      return c.json({ error: "Invalid signature" }, 401);
    }

    const payload = JSON.parse(body) as Record<string, unknown>;

    if (event === "pull_request") {
      const action = payload["action"] as string | undefined;
      if (action === "opened" || action === "synchronize" || action === "reopened") {
        await enqueuePRReview(payload, reviewQueue, db);
      }
    }

    if (event === "installation" || event === "installation_repositories") {
      await handleInstallationEvent(event, payload, db);
    }

    return c.json({ ok: true });
  });

  return router;
}

async function enqueuePRReview(
  payload: Record<string, unknown>,
  reviewQueue: Queue,
  db: PrismaClient
) {
  const pr = payload["pull_request"] as Record<string, unknown>;
  const repo = payload["repository"] as Record<string, unknown>;
  const installation = payload["installation"] as Record<string, unknown> | undefined;

  const fullName = repo["full_name"] as string;
  const prNumber = pr["number"] as number;
  const headSha = (pr["head"] as Record<string, unknown>)["sha"] as string;
  const installationId = installation?.["id"] as number | undefined;

  if (!installationId) return;

  const repository = await db.repository.findUnique({ where: { fullName } });
  if (!repository?.enabled) return;

  const review = await db.review.create({
    data: {
      repositoryId: repository.id,
      prNumber,
      prTitle: pr["title"] as string,
      prUrl: (pr["html_url"] as string) ?? "",
      headSha,
      status: "PENDING",
    },
  });

  await reviewQueue.add("review", {
    reviewId: review.id,
    repositoryId: repository.id,
    installationId,
    prNumber,
    headSha,
    owner: repository.owner,
    repo: repository.name,
  });
}

// Task 15c handler — also called directly from installation webhook
export async function handleInstallationEvent(
  event: string,
  payload: Record<string, unknown>,
  db: PrismaClient
) {
  const installation = payload["installation"] as Record<string, unknown>;
  const installationId = installation["id"] as number;
  const action = payload["action"] as string;

  const reposAdded: Array<Record<string, unknown>> =
    event === "installation"
      ? (payload["repositories"] as Array<Record<string, unknown>>) ?? []
      : (payload["repositories_added"] as Array<Record<string, unknown>>) ?? [];

  const reposRemoved: Array<Record<string, unknown>> =
    (payload["repositories_removed"] as Array<Record<string, unknown>>) ?? [];

  if (action === "deleted") {
    await db.repository.deleteMany({ where: { installationId } });
    return;
  }

  for (const r of reposAdded) {
    const fullName = r["full_name"] as string;
    const [owner = "", name = ""] = fullName.split("/");
    await db.repository.upsert({
      where: { fullName },
      create: {
        githubId: r["id"] as number,
        owner,
        name,
        fullName,
        installationId,
        enabled: false,
      },
      update: { installationId },
    });
  }

  for (const r of reposRemoved) {
    const fullName = r["full_name"] as string;
    await db.repository.deleteMany({ where: { fullName } });
  }
}
