import { generateText } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { Octokit } from "@octokit/rest";
import type { ParsedDiff, DiffFile } from "./diff";
import type { LintResult } from "./linters/types";
import type { SecurityFinding } from "./security/types";
import type { ContextSnippet } from "./context/index";

export interface ReviewInput {
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  headSha: string;
  diff: ParsedDiff;
  lintResults: LintResult[];
  securityFindings: SecurityFinding[];
  context: ContextSnippet[];
}

export interface ReviewOutput {
  summary: string;
  walkthrough: string;
  inlineComments: InlineComment[];
}

export interface InlineComment {
  path: string;
  line: number;
  body: string;
}

/**
 * Build the review prompt and call the AI model.
 */
export async function generateReview(
  input: ReviewInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: LanguageModelV3 | any
): Promise<ReviewOutput> {
  const prompt = buildPrompt(input);

  const { text } = await generateText({ model, prompt });

  return parseReviewResponse(text);
}

function buildPrompt(input: ReviewInput): string {
  const { prTitle, diff, lintResults, securityFindings, context } = input;

  const diffSummary = diff.files
    .map((f) => `### ${f.path} (+${f.additions} -${f.deletions})\n${formatHunks(f)}`)
    .join("\n\n");

  const lintSummary = lintResults.flatMap((r) =>
    r.diagnostics.map(
      (d) => `- [${r.tool}] ${d.file}:${d.line} ${d.severity}: ${d.rule} — ${d.message}`
    )
  );

  const securitySummary = securityFindings.map(
    (f) => `- [${f.tool}] ${f.severity.toUpperCase()}: ${f.title} — ${f.message}${f.file ? ` (${f.file}:${f.line ?? ""})` : ""}`
  );

  const contextSummary = context.map(
    (s) => `// ${s.file} (${s.reason})\n${s.content}`
  );

  return `You are an expert code reviewer. Review the following pull request and respond in the exact JSON format specified.

## PR Title
${prTitle}

## Diff
${diffSummary}

${lintSummary.length > 0 ? `## Lint Issues\n${lintSummary.join("\n")}` : ""}

${securitySummary.length > 0 ? `## Security Findings\n${securitySummary.join("\n")}` : ""}

${contextSummary.length > 0 ? `## Related Context\n${contextSummary.join("\n\n")}` : ""}

## Instructions
Respond with a JSON object with this exact shape:
{
  "summary": "1-3 sentence high-level summary of what this PR does",
  "walkthrough": "Detailed walkthrough of the changes, grouped by file or feature",
  "inlineComments": [
    { "path": "relative/file/path.ts", "line": 42, "body": "Comment text" }
  ]
}

Focus inline comments on: bugs, security issues, performance problems, and logic errors.
Do NOT comment on style, naming conventions, or trivial nits.
If the code looks good, return an empty inlineComments array.
Respond with valid JSON only — no markdown fences, no extra text.`;
}

function formatHunks(file: DiffFile): string {
  return file.hunks
    .map((h) => {
      const lines = h.lines
        .map((l) => (l.type === "add" ? `+${l.content}` : l.type === "del" ? `-${l.content}` : ` ${l.content}`))
        .join("\n");
      return `${h.header}\n${lines}`;
    })
    .join("\n");
}

function parseReviewResponse(text: string): ReviewOutput {
  try {
    const parsed = JSON.parse(text) as ReviewOutput;
    return {
      summary: parsed.summary ?? "",
      walkthrough: parsed.walkthrough ?? "",
      inlineComments: Array.isArray(parsed.inlineComments) ? parsed.inlineComments : [],
    };
  } catch {
    // If JSON parse fails, treat the whole text as summary
    return { summary: text, walkthrough: "", inlineComments: [] };
  }
}

/**
 * Post the review to GitHub as a PR review with inline comments.
 */
export async function postReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  review: ReviewOutput
): Promise<void> {
  const body = `## Summary\n\n${review.summary}\n\n## Walkthrough\n\n${review.walkthrough}`;

  const comments = review.inlineComments.map((c) => ({
    path: c.path,
    line: c.line,
    body: c.body,
  }));

  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    commit_id: headSha,
    body,
    event: "COMMENT",
    comments,
  });
}
