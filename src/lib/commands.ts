import type { Octokit } from "@octokit/rest";
import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";

export type ChatCommand = "review" | "pause" | "resume" | "ignore" | "help";

const COMMAND_PATTERN = /^@openbunny\s+(review|pause|resume|ignore|help)\b/i;

export interface ParsedCommand {
  command: ChatCommand;
  args: string;
}

export function parseCommand(body: string): ParsedCommand | null {
  const match = body.match(COMMAND_PATTERN);
  if (!match) return null;
  const command = match[1]!.toLowerCase() as ChatCommand;
  const args = body.slice(match[0].length).trim();
  return { command, args };
}

export interface CommandContext {
  octokit: Octokit;
  db: PrismaClient;
  reviewQueue: Queue;
  owner: string;
  repo: string;
  repoId: string;
  prNumber: number;
  installationId: number;
  headSha: string;
  commentId: number;
}

export async function handleCommand(
  parsed: ParsedCommand,
  ctx: CommandContext
): Promise<void> {
  const { octokit, db, reviewQueue, owner, repo, prNumber } = ctx;

  switch (parsed.command) {
    case "review": {
      // Trigger a new review immediately
      await reviewQueue.add("review", {
        repositoryId: ctx.repoId,
        installationId: ctx.installationId,
        prNumber,
        headSha: ctx.headSha,
        owner,
        repo,
      });
      await replyToComment(octokit, owner, repo, prNumber, "Starting a new review...");
      break;
    }

    case "pause": {
      await db.repository.update({
        where: { id: ctx.repoId },
        data: { enabled: false },
      });
      await replyToComment(octokit, owner, repo, prNumber, "Reviews paused for this repository. Use `@openbunny resume` to re-enable.");
      break;
    }

    case "resume": {
      await db.repository.update({
        where: { id: ctx.repoId },
        data: { enabled: true },
      });
      await replyToComment(octokit, owner, repo, prNumber, "Reviews resumed.");
      break;
    }

    case "ignore": {
      // Mark the latest review for this PR as skipped
      await db.review.updateMany({
        where: { repositoryId: ctx.repoId, prNumber, status: "PENDING" },
        data: { status: "SKIPPED" },
      });
      await replyToComment(octokit, owner, repo, prNumber, "This PR will be ignored.");
      break;
    }

    case "help": {
      await replyToComment(
        octokit, owner, repo, prNumber,
        [
          "**OpenBunny commands:**",
          "- `@openbunny review` — trigger a new review",
          "- `@openbunny pause` — pause reviews for this repo",
          "- `@openbunny resume` — resume reviews for this repo",
          "- `@openbunny ignore` — skip reviewing this PR",
          "- `@openbunny help` — show this message",
        ].join("\n")
      );
      break;
    }
  }
}

async function replyToComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  await octokit.issues.createComment({ owner, repo, issue_number: prNumber, body });
}
