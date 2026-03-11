import { spawnSync } from "child_process";
import type { SecurityFinding } from "./types";

interface SemgrepResult {
  results: Array<{
    path: string;
    start: { line: number };
    check_id: string;
    extra: { message: string; severity: string };
  }>;
}

/**
 * Run Semgrep with auto config on changed files.
 * Returns empty array if Semgrep is not installed or finds nothing.
 */
export function runSemgrep(files: string[], cwd: string): SecurityFinding[] {
  if (files.length === 0) return [];

  const result = spawnSync(
    "semgrep",
    ["--config=auto", "--json", "--quiet", ...files],
    { cwd, encoding: "utf8", timeout: 60_000 }
  );

  if (result.error) return [];

  let parsed: SemgrepResult;
  try {
    parsed = JSON.parse(result.stdout) as SemgrepResult;
  } catch {
    return [];
  }

  return parsed.results.map((r) => ({
    tool: "semgrep",
    severity: normalizeSeverity(r.extra.severity),
    title: r.check_id,
    message: r.extra.message,
    file: r.path,
    line: r.start.line,
    rule: r.check_id,
  }));
}

function normalizeSeverity(s: string): SecurityFinding["severity"] {
  switch (s.toLowerCase()) {
    case "error": return "high";
    case "warning": return "medium";
    case "info": return "info";
    default: return "medium";
  }
}
