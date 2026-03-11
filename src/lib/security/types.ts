export interface SecurityFinding {
  tool: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  message: string;
  file?: string;
  line?: number;
  rule?: string;
}
