import { spawnSync } from "child_process";
import type { SecurityFinding } from "./types";

interface TrivyVulnerability {
  VulnerabilityID: string;
  PkgName: string;
  Title: string;
  Description: string;
  Severity: string;
}

interface TrivyResult {
  Results?: Array<{
    Vulnerabilities?: TrivyVulnerability[];
  }>;
}

/**
 * Run Trivy filesystem scan to detect vulnerable dependencies.
 * Returns empty array if Trivy is not installed.
 */
export function runTrivy(repoDir: string): SecurityFinding[] {
  const result = spawnSync(
    "trivy",
    ["fs", "--format=json", "--quiet", repoDir],
    { cwd: repoDir, encoding: "utf8", timeout: 60_000 }
  );

  if (result.error) return [];

  let parsed: TrivyResult;
  try {
    parsed = JSON.parse(result.stdout) as TrivyResult;
  } catch {
    return [];
  }

  const findings: SecurityFinding[] = [];
  for (const r of parsed.Results ?? []) {
    for (const vuln of r.Vulnerabilities ?? []) {
      findings.push({
        tool: "trivy",
        severity: normalizeSeverity(vuln.Severity),
        title: `${vuln.VulnerabilityID} in ${vuln.PkgName}`,
        message: vuln.Title || vuln.Description,
        rule: vuln.VulnerabilityID,
      });
    }
  }
  return findings;
}

function normalizeSeverity(s: string): SecurityFinding["severity"] {
  switch (s.toUpperCase()) {
    case "CRITICAL": return "critical";
    case "HIGH": return "high";
    case "MEDIUM": return "medium";
    case "LOW": return "low";
    default: return "info";
  }
}
