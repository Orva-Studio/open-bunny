import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { encrypt, decrypt } from "../../lib/crypto";
import { OPENAI_REVIEW_MODELS, OPENAI_LIGHT_MODELS } from "../../lib/ai";

export function createSettingsRouter(db: PrismaClient) {
  const router = new Hono();

  // GET /api/settings
  router.get("/", async (c) => {
    const cfg = await db.appConfig.findFirst();
    if (!cfg) return c.json({});

    return c.json({
      aiProvider: cfg.aiProviderEncrypted ? decrypt(cfg.aiProviderEncrypted) : null,
      // Mask key — return only last 4 chars so UI can show "••••••••abcd"
      aiApiKeyMasked: cfg.aiApiKeyEncrypted
        ? maskKey(decrypt(cfg.aiApiKeyEncrypted))
        : null,
      aiReviewModel: cfg.aiReviewModel,
      aiLightModel: cfg.aiLightModel,
      availableReviewModels: OPENAI_REVIEW_MODELS,
      availableLightModels: OPENAI_LIGHT_MODELS,
    });
  });

  // PATCH /api/settings
  router.patch(
    "/",
    zValidator(
      "json",
      z.object({
        aiProvider: z.string().optional(),
        aiApiKey: z.string().optional(),
        aiReviewModel: z.string().optional(),
        aiLightModel: z.string().optional(),
      })
    ),
    async (c) => {
      const body = c.req.valid("json");

      const update: Record<string, string | null> = {};
      if (body.aiProvider !== undefined) update["aiProviderEncrypted"] = encrypt(body.aiProvider);
      if (body.aiApiKey !== undefined) update["aiApiKeyEncrypted"] = encrypt(body.aiApiKey);
      if (body.aiReviewModel !== undefined) update["aiReviewModel"] = body.aiReviewModel;
      if (body.aiLightModel !== undefined) update["aiLightModel"] = body.aiLightModel;

      const cfg = await db.appConfig.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", ...update },
        update,
      });

      return c.json({ ok: true, aiReviewModel: cfg.aiReviewModel, aiLightModel: cfg.aiLightModel });
    }
  );

  return router;
}

function maskKey(key: string): string {
  if (key.length <= 4) return "••••";
  return "••••••••" + key.slice(-4);
}
