import { spawnSync } from "child_process";
import type { LintDiagnostic, LintResult } from "./types";

interface ShellCheckComment {
  file: string;
  line: number;
  column: number;
  level: "error" | "warning" | "info" | "style";
  code: number;
  message: string;
}

/**
 * Run ShellCheck on shell script files. Returns an empty result if ShellCheck is not installed.
 */
export function runShellcheck(files: string[], cwd: string): LintResult {
  const shFiles = files.filter((f) => /\.(sh|bash|zsh)$/.test(f));
  if (shFiles.length === 0) return { tool: "shellcheck", diagnostics: [] };

  const result = spawnSync("shellcheck", ["--format=json", ...shFiles], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  });

  if (result.error) return { tool: "shellcheck", diagnostics: [] };

  let parsed: ShellCheckComment[] = [];
  try {
    parsed = JSON.parse(result.stdout) as ShellCheckComment[];
  } catch {
    return { tool: "shellcheck", diagnostics: [], raw: result.stdout };
  }

  const diagnostics: LintDiagnostic[] = parsed.map((c) => ({
    file: c.file,
    line: c.line,
    column: c.column,
    severity: c.level === "error" ? "error" : c.level === "warning" ? "warning" : "info",
    rule: `SC${c.code}`,
    message: c.message,
  }));

  return { tool: "shellcheck", diagnostics };
}
