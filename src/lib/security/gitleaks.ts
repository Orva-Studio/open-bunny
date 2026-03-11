import { spawnSync } from "child_process";
import type { SecurityFinding } from "./types";

interface GitleaksFinding {
  Description: string;
  Secret: string;
  File: string;
  StartLine: number;
  RuleID: string;
}

/**
 * Run Gitleaks on the git diff to detect leaked secrets.
 * Returns empty array if Gitleaks is not installed.
 */
export function runGitleaks(repoDir: string, baseSha: string, headSha: string): SecurityFinding[] {
  const result = spawnSync(
    "gitleaks",
    [
      "detect",
      "--source", repoDir,
      "--log-opts", `${baseSha}..${headSha}`,
      "--report-format", "json",
      "--report-path", "/dev/stdout",
      "--no-banner",
      "--exit-code", "0",
    ],
    { cwd: repoDir, encoding: "utf8", timeout: 30_000 }
  );

  if (result.error) return [];

  let parsed: GitleaksFinding[] = [];
  try {
    parsed = JSON.parse(result.stdout) as GitleaksFinding[];
  } catch {
    return [];
  }

  return (parsed ?? []).map((f) => ({
    tool: "gitleaks",
    severity: "critical" as const,
    title: "Potential secret detected",
    message: f.Description,
    file: f.File,
    line: f.StartLine,
    rule: f.RuleID,
  }));
}
