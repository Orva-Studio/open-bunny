import { spawnSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname, basename } from "path";

export interface ContextSnippet {
  file: string;
  startLine: number;
  endLine: number;
  content: string;
  reason: "caller" | "callee" | "definition" | "test";
}

/**
 * Retrieve relevant context snippets for changed files.
 * Uses grep-based heuristics to find callers/callees without requiring an LSP.
 */
export function getRelevantContext(
  changedFiles: string[],
  repoDir: string,
  maxSnippets = 10
): ContextSnippet[] {
  const snippets: ContextSnippet[] = [];

  for (const file of changedFiles) {
    if (snippets.length >= maxSnippets) break;

    const absPath = resolve(repoDir, file);
    if (!existsSync(absPath)) continue;

    // Find test files related to changed files
    const testSnippets = findRelatedTests(file, repoDir);
    snippets.push(...testSnippets.slice(0, 3));

    // Find callers of exported symbols
    const callerSnippets = findCallers(file, repoDir);
    snippets.push(...callerSnippets.slice(0, 3));
  }

  return snippets.slice(0, maxSnippets);
}

function findRelatedTests(file: string, repoDir: string): ContextSnippet[] {
  const base = basename(file).replace(/\.(ts|js|tsx|jsx|py)$/, "");
  const patterns = [`${base}.test.`, `${base}.spec.`, `test_${base}`];

  const results: ContextSnippet[] = [];
  for (const pattern of patterns) {
    const result = spawnSync(
      "grep",
      ["-rl", pattern, "--include=*.ts", "--include=*.js", "--include=*.py", repoDir],
      { encoding: "utf8", timeout: 10_000 }
    );
    if (result.error || !result.stdout.trim()) continue;

    for (const testFile of result.stdout.trim().split("\n").slice(0, 2)) {
      const snippet = readSnippet(testFile, 1, 30, "test");
      if (snippet) results.push(snippet);
    }
  }
  return results;
}

function findCallers(file: string, repoDir: string): ContextSnippet[] {
  const base = basename(file).replace(/\.(ts|js|tsx|jsx|py)$/, "");

  const result = spawnSync(
    "grep",
    ["-rn", `from.*${base}|require.*${base}|import.*${base}`, "--include=*.ts", "--include=*.js", repoDir],
    { encoding: "utf8", timeout: 10_000 }
  );
  if (result.error || !result.stdout.trim()) return [];

  const callerFiles = [
    ...new Set(
      result.stdout
        .trim()
        .split("\n")
        .map((line) => line.split(":")[0] ?? "")
        .filter(Boolean)
    ),
  ].slice(0, 3);

  return callerFiles
    .map((f) => readSnippet(f, 1, 20, "caller"))
    .filter((s): s is ContextSnippet => s !== null);
}

function readSnippet(
  filePath: string,
  startLine: number,
  endLine: number,
  reason: ContextSnippet["reason"]
): ContextSnippet | null {
  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const slice = lines.slice(startLine - 1, endLine).join("\n");
    return { file: filePath, startLine, endLine, content: slice, reason };
  } catch {
    return null;
  }
}
