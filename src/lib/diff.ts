export interface ParsedDiff {
  files: DiffFile[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  isBinary: boolean;
  isDeleted: boolean;
  isNew: boolean;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "add" | "del" | "context";
  content: string;
  lineNumber?: number;
}

/** File extensions that should be skipped during review */
const SKIP_EXTENSIONS = new Set([
  ".lock", ".snap", ".min.js", ".min.css", ".map",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
  ".woff", ".woff2", ".ttf", ".eot",
  ".pdf", ".zip", ".tar", ".gz",
]);

/** Paths/globs that indicate generated or vendor files */
const SKIP_PATTERNS = [
  /^(dist|build|out|\.next|\.nuxt)\//,
  /^node_modules\//,
  /^vendor\//,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /bun\.lock/,
  /CHANGELOG\.md$/i,
];

export function parseDiff(rawDiff: string): ParsedDiff {
  const files: DiffFile[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  const fileBlocks = rawDiff.split(/^diff --git /m).filter(Boolean);

  for (const block of fileBlocks) {
    const lines = block.split("\n");
    const headerLine = lines[0] ?? "";
    const pathMatch = headerLine.match(/b\/(.+)$/);
    const path = pathMatch?.[1] ?? "";

    const isBinary = block.includes("\nBinary files");
    const isDeleted = block.includes("\ndeleted file mode");
    const isNew = block.includes("\nnew file mode");

    let additions = 0;
    let deletions = 0;
    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;

    for (const line of lines) {
      if (line.startsWith("@@")) {
        currentHunk = { header: line, lines: [] };
        hunks.push(currentHunk);
      } else if (currentHunk) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          currentHunk.lines.push({ type: "add", content: line.slice(1) });
          additions++;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          currentHunk.lines.push({ type: "del", content: line.slice(1) });
          deletions++;
        } else if (line.startsWith(" ")) {
          currentHunk.lines.push({ type: "context", content: line.slice(1) });
        }
      }
    }

    totalAdditions += additions;
    totalDeletions += deletions;
    files.push({ path, additions, deletions, hunks, isBinary, isDeleted, isNew });
  }

  return { files, totalAdditions, totalDeletions };
}

/** Filter out files that should not be reviewed */
export function filterReviewableFiles(files: DiffFile[]): DiffFile[] {
  return files.filter((f) => {
    if (f.isBinary) return false;
    if (SKIP_PATTERNS.some((p) => p.test(f.path))) return false;
    if (SKIP_EXTENSIONS.has(getExtension(f.path))) return false;
    return true;
  });
}

/** Detect if a PR is trivial (e.g. only lockfile, docs, formatting changes) */
export function isTrivialChange(files: DiffFile[]): boolean {
  const reviewable = filterReviewableFiles(files);
  if (reviewable.length === 0) return true;

  // Only markdown/txt changes
  const allDocs = reviewable.every((f) => /\.(md|txt|rst)$/i.test(f.path));
  if (allDocs) return true;

  return false;
}

function getExtension(path: string): string {
  const match = path.match(/(\.[^.]+)$/);
  return match?.[1] ?? "";
}
