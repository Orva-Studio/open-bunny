import { spawnSync } from "child_process";
import type { LintDiagnostic, LintResult } from "./types";

interface RuffMessage {
  filename: string;
  location: { row: number; column: number };
  code: string;
  message: string;
}

/**
 * Run Ruff on Python files. Returns an empty result if Ruff is not installed.
 */
export function runRuff(files: string[], cwd: string): LintResult {
  const pyFiles = files.filter((f) => f.endsWith(".py"));
  if (pyFiles.length === 0) return { tool: "ruff", diagnostics: [] };

  const result = spawnSync("ruff", ["check", "--output-format=json", ...pyFiles], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  });

  if (result.error) return { tool: "ruff", diagnostics: [] };

  let parsed: RuffMessage[] = [];
  try {
    parsed = JSON.parse(result.stdout) as RuffMessage[];
  } catch {
    return { tool: "ruff", diagnostics: [], raw: result.stdout };
  }

  const diagnostics: LintDiagnostic[] = parsed.map((msg) => ({
    file: msg.filename,
    line: msg.location.row,
    column: msg.location.column,
    severity: "warning",
    rule: msg.code,
    message: msg.message,
  }));

  return { tool: "ruff", diagnostics };
}
