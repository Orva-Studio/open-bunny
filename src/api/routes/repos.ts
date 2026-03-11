import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

export function createReposRouter(db: PrismaClient) {
  const router = new Hono();

  // GET /api/repos — list all known repositories
  router.get("/", async (c) => {
    const repos = await db.repository.findMany({
      orderBy: [{ owner: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { reviews: true } },
      },
    });
    return c.json(repos);
  });

  // PATCH /api/repos/:id — enable or disable a repository
  router.patch(
    "/:id",
    zValidator("json", z.object({ enabled: z.boolean() })),
    async (c) => {
      const { id } = c.req.param();
      const { enabled } = c.req.valid("json");

      const repo = await db.repository.update({
        where: { id },
        data: { enabled },
      });
      return c.json(repo);
    }
  );

  // POST /api/repos/auto-enroll — enable all repos for an installation
  router.post(
    "/auto-enroll",
    zValidator("json", z.object({ installationId: z.number().int() })),
    async (c) => {
      const { installationId } = c.req.valid("json");
      const result = await db.repository.updateMany({
        where: { installationId },
        data: { enabled: true },
      });
      return c.json({ updated: result.count });
    }
  );

  return router;
}
