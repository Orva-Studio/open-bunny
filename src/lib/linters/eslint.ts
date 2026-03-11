import { spawnSync } from "child_process";
import type { LintDiagnostic, LintResult } from "./types";

interface EslintMessage {
  line: number;
  column: number;
  severity: number; // 1 = warn, 2 = error
  ruleId: string | null;
  message: string;
}

interface EslintFileResult {
  filePath: string;
  messages: EslintMessage[];
}

/**
 * Run ESLint on a list of files. Returns an empty result if ESLint is not installed.
 */
export function runEslint(files: string[], cwd: string): LintResult {
  if (files.length === 0) return { tool: "eslint", diagnostics: [] };

  const jsFiles = files.filter((f) =>
    /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(f)
  );
  if (jsFiles.length === 0) return { tool: "eslint", diagnostics: [] };

  const result = spawnSync(
    "npx",
    ["eslint", "--format=json", "--no-eslintrc", "--rule", "{}", ...jsFiles],
    { cwd, encoding: "utf8", timeout: 30_000 }
  );

  if (result.error) return { tool: "eslint", diagnostics: [] };

  let parsed: EslintFileResult[] = [];
  try {
    parsed = JSON.parse(result.stdout) as EslintFileResult[];
  } catch {
    return { tool: "eslint", diagnostics: [], raw: result.stdout };
  }

  const diagnostics: LintDiagnostic[] = [];
  for (const fileResult of parsed) {
    for (const msg of fileResult.messages) {
      diagnostics.push({
        file: fileResult.filePath,
        line: msg.line,
        column: msg.column,
        severity: msg.severity === 2 ? "error" : "warning",
        rule: msg.ruleId ?? "unknown",
        message: msg.message,
      });
    }
  }

  return { tool: "eslint", diagnostics };
}
