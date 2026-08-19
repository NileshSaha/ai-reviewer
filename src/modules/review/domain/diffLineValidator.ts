/**
 * Normalizes a file path by removing leading './' or '/' and trimming whitespace.
 */
export function normalizeFilePath(filePath: string): string {
  if (!filePath) return '';
  return filePath.trim().replace(/^(\.\/|\/)+/, '');
}

/**
 * Parses a unified diff patch and returns the set of all valid line numbers
 * in the new file (RIGHT side of diff) that are part of the diff hunks.
 */
export function parseValidDiffLines(patch?: string | null): Set<number> {
  const validLines = new Set<number>();
  if (!patch || typeof patch !== 'string') {
    return validLines;
  }

  // Remove trailing newlines to prevent spurious context lines at EOF
  const lines = patch.trimEnd().split('\n');
  let currentNewLine = 0;
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      // Hunk header format: @@ -oldStart[,oldCount] +newStart[,newCount] @@ [optional context]
      const match = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (match) {
        currentNewLine = parseInt(match[1], 10);
        inHunk = true;
      } else {
        inHunk = false;
      }
      continue;
    }

    if (!inHunk) {
      continue;
    }

    if (line.startsWith('+') || line.startsWith(' ') || line === '') {
      if (currentNewLine > 0) {
        validLines.add(currentNewLine);
      }
      currentNewLine++;
    } else if (line.startsWith('-')) {
      // Deletion belongs to the old file; does not advance new file line counter
      continue;
    } else if (line.startsWith('\\')) {
      // e.g. "\ No newline at end of file"
      continue;
    }
  }

  return validLines;
}

/**
 * Builds a Map from normalized filename to the Set of valid line numbers in that file's diff.
 */
export function buildValidDiffLinesMap(
  files: Array<{ filename: string; patch?: string | null }>
): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const file of files) {
    if (!file || !file.filename) continue;
    const normalized = normalizeFilePath(file.filename);
    const validLines = parseValidDiffLines(file.patch);
    map.set(normalized, validLines);
  }
  return map;
}

/**
 * Checks if a file and line number exist within the diff hunks of the PR.
 */
export function isLineInDiff(
  validDiffLinesMap: Map<string, Set<number>>,
  file: string,
  line?: number
): boolean {
  if (!file || line === undefined || line === null || line <= 0) {
    return false;
  }
  const normalized = normalizeFilePath(file);
  const validLines = validDiffLinesMap.get(normalized);
  if (!validLines) {
    return false;
  }
  return validLines.has(line);
}
