export interface LintDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
}

export interface LintResult {
  tool: string;
  diagnostics: LintDiagnostic[];
  /** Raw stdout from the tool, for debugging */
  raw?: string;
}
