import { Worker, Queue } from "bullmq";
import { mkdirSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";
import { parseWorkerEnv } from "./env";
import { db } from "../lib/db";
import { decrypt } from "../lib/crypto";
import { createAIModel } from "../lib/ai";
import { getInstallationOctokit } from "../lib/github";
import { parseDiff, filterReviewableFiles, isTrivialChange } from "../lib/diff";
import { generateReview, postReview } from "../lib/review";
import { runEslint, runRuff, runShellcheck } from "../lib/linters/index";
import { runSemgrep, runGitleaks } from "../lib/security/index";
import { getRelevantContext } from "../lib/context/index";
import { parseCommand, handleCommand } from "../lib/commands";

const env = parseWorkerEnv();
mkdirSync(env.WORK_DIR, { recursive: true });

export interface ReviewJobData {
  reviewId?: string;
  repositoryId: string;
  installationId: number;
  prNumber: number;
  headSha: string;
  owner: string;
  repo: string;
}

export interface CommentJobData {
  repositoryId: string;
  installationId: number;
  prNumber: number;
  headSha: string;
  owner: string;
  repo: string;
  commentId: number;
  body: string;
}

const connection = { url: env.REDIS_URL };

// Worker: process PR reviews
const reviewWorker = new Worker<ReviewJobData>(
  "review",
  async (job) => {
    const { reviewId, repositoryId, installationId, prNumber, headSha, owner, repo } = job.data;

    if (reviewId) {
      await db.review.update({ where: { id: reviewId }, data: { status: "IN_PROGRESS" } });
    }

    try {
      const appCfg = await db.appConfig.findFirst();
      if (!appCfg?.githubPrivateKeyEncrypted || !appCfg.githubAppId) {
        throw new Error("GitHub App not configured");
      }

      const octokit = getInstallationOctokit(
        {
          appId: Number(appCfg.githubAppId),
          privateKey: decrypt(appCfg.githubPrivateKeyEncrypted),
          clientId: appCfg.githubClientIdEncrypted ? decrypt(appCfg.githubClientIdEncrypted) : "",
          clientSecret: appCfg.githubClientSecretEncrypted ? decrypt(appCfg.githubClientSecretEncrypted) : "",
          webhookSecret: appCfg.githubWebhookSecretEncrypted ? decrypt(appCfg.githubWebhookSecretEncrypted) : "",
        },
        installationId
      );

      // Fetch diff from GitHub
      const diffResponse = await octokit.pulls.get({
        owner, repo, pull_number: prNumber,
        mediaType: { format: "diff" },
      });
      const rawDiff = diffResponse.data as unknown as string;

      const diff = parseDiff(rawDiff);
      const reviewableFiles = filterReviewableFiles(diff.files);

      // Skip trivial PRs
      if (isTrivialChange(diff.files)) {
        if (reviewId) {
          await db.review.update({ where: { id: reviewId }, data: { status: "SKIPPED" } });
        }
        return;
      }

      // Clone repo for static analysis
      const repoDir = resolve(env.WORK_DIR, `${owner}-${repo}-${headSha.slice(0, 8)}`);
      execSync(
        `git clone --depth=1 https://x-access-token:${await getInstallationToken(octokit, installationId)}@github.com/${owner}/${repo}.git ${repoDir}`,
        { timeout: 60_000 }
      );

      const filePaths = reviewableFiles.map((f) => f.path);

      // Run linters + security in parallel
      const [lintResults, securityFindings, context] = await Promise.all([
        Promise.resolve([
          runEslint(filePaths, repoDir),
          runRuff(filePaths, repoDir),
          runShellcheck(filePaths, repoDir),
        ]),
        Promise.resolve([
          ...runSemgrep(filePaths, repoDir),
          ...runGitleaks(repoDir, `${headSha}~1`, headSha),
        ]),
        Promise.resolve(getRelevantContext(filePaths, repoDir)),
      ]);

      // Build AI model
      if (!appCfg.aiApiKeyEncrypted || !appCfg.aiReviewModel) {
        throw new Error("AI not configured");
      }
      const model = createAIModel({
        provider: appCfg.aiProviderEncrypted ? decrypt(appCfg.aiProviderEncrypted) as "openai" : "openai",
        model: appCfg.aiReviewModel,
        apiKey: decrypt(appCfg.aiApiKeyEncrypted),
      });

      // Get PR title
      const prData = await octokit.pulls.get({ owner, repo, pull_number: prNumber });

      const reviewOutput = await generateReview(
        {
          owner, repo, prNumber,
          prTitle: prData.data.title,
          headSha,
          diff: { ...diff, files: reviewableFiles },
          lintResults,
          securityFindings,
          context,
        },
        model
      );

      await postReview(octokit, owner, repo, prNumber, headSha, reviewOutput);

      if (reviewId) {
        await db.review.update({
          where: { id: reviewId },
          data: { status: "COMPLETED", summaryMarkdown: reviewOutput.summary },
        });
      }

      // Cleanup clone
      execSync(`rm -rf ${repoDir}`);
    } catch (err) {
      if (reviewId) {
        await db.review.update({ where: { id: reviewId }, data: { status: "FAILED" } });
      }
      throw err;
    }
  },
  { connection, concurrency: 3 }
);

// Worker: handle @openbunny chat commands
const commentWorker = new Worker<CommentJobData>(
  "comment",
  async (job) => {
    const { repositoryId, installationId, prNumber, headSha, owner, repo, commentId, body } = job.data;

    const parsed = parseCommand(body);
    if (!parsed) return;

    const appCfg = await db.appConfig.findFirst();
    if (!appCfg?.githubPrivateKeyEncrypted || !appCfg.githubAppId) return;

    const octokit = getInstallationOctokit(
      {
        appId: Number(appCfg.githubAppId),
        privateKey: decrypt(appCfg.githubPrivateKeyEncrypted),
        clientId: appCfg.githubClientIdEncrypted ? decrypt(appCfg.githubClientIdEncrypted) : "",
        clientSecret: appCfg.githubClientSecretEncrypted ? decrypt(appCfg.githubClientSecretEncrypted) : "",
        webhookSecret: appCfg.githubWebhookSecretEncrypted ? decrypt(appCfg.githubWebhookSecretEncrypted) : "",
      },
      installationId
    );

    const reviewQueue = new Queue("review", { connection });

    await handleCommand(parsed, {
      octokit,
      db,
      reviewQueue,
      owner,
      repo,
      repoId: repositoryId,
      prNumber,
      installationId,
      headSha,
      commentId,
    });
  },
  { connection }
);

reviewWorker.on("failed", (job, err) => {
  console.error(`Review job ${job?.id} failed:`, err.message);
});

commentWorker.on("failed", (job, err) => {
  console.error(`Comment job ${job?.id} failed:`, err.message);
});

console.log("OpenBunny worker started.");

async function getInstallationToken(octokit: Octokit, installationId: number): Promise<string> {
  const { data } = await (octokit as any).apps.createInstallationAccessToken({ installation_id: installationId });
  return data.token as string;
}

// Re-export for type use
import type { Octokit } from "@octokit/rest";
