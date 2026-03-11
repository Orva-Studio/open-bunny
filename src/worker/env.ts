import { z } from "zod";

const WorkerEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().length(64),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  /** Temporary directory for cloning repos during review */
  WORK_DIR: z.string().default("/tmp/openbunny"),
});

export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

export function parseWorkerEnv(): WorkerEnv {
  const result = WorkerEnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Missing or invalid environment variables:\n${issues}`);
  }
  return result.data;
}
