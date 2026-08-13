export interface DiffFileEntry {
  filename: string;
  patch: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions?: number;
  deletions?: number;
}

export interface TruncatedDiffFile {
  filename: string;
  status: DiffFileEntry['status'];
  patch: string;
  truncated: boolean;
  originalChars: number;
}

export interface OmittedFile {
  filename: string;
  reason: 'budget';
}

export interface FitResult {
  files: TruncatedDiffFile[];
  omitted: OmittedFile[];
  totalChars: number;
  truncatedCount: number;
  droppedCount: number;
}

export interface FitOptions {
  maxPromptChars: number;
  maxPatchCharsPerFile: number;
  charsPerToken?: number;
  reservedChars?: number;
}

const DEFAULT_RESERVED_CHARS = 1500;
const DEFAULT_CHARS_PER_TOKEN = 4;

export function truncatePatch(
  patch: string,
  maxChars: number
): { patch: string; truncated: boolean; originalChars: number } {
  if (!patch || patch.length <= maxChars) {
    return { patch: patch ?? '', truncated: false, originalChars: patch?.length ?? 0 };
  }

  const headSize = Math.floor(maxChars * 0.7);
  const tailSize = Math.max(0, maxChars - headSize - 60);
  const head = patch.slice(0, headSize);
  const tail = patch.slice(patch.length - tailSize);
  const omitted = patch.length - headSize - tailSize;
  const marker = `\n... [truncated ${omitted} chars] ...\n`;
  return {
    patch: head + marker + tail,
    truncated: true,
    originalChars: patch.length,
  };
}

export function fitToTokenBudget(files: DiffFileEntry[], options: FitOptions): FitResult {
  const {
    maxPromptChars,
    maxPatchCharsPerFile,
    reservedChars = DEFAULT_RESERVED_CHARS,
  } = options;

  const usableChars = Math.max(0, maxPromptChars - reservedChars);

  const sorted = files
    .filter((f) => f.patch && f.status !== 'deleted')
    .sort((a, b) => {
      const aSize = (a.additions ?? 0) + (a.deletions ?? 0);
      const bSize = (b.additions ?? 0) + (b.deletions ?? 0);
      return bSize - aSize;
    });

  const kept: TruncatedDiffFile[] = [];
  const omitted: OmittedFile[] = [];
  let remainingChars = usableChars;
  let truncatedCount = 0;

  for (const file of sorted) {
    const patch = file.patch ?? '';
    const overhead = file.filename.length + 30;

    if (remainingChars < overhead + 100) {
      omitted.push({ filename: file.filename, reason: 'budget' });
      continue;
    }

    const patchBudget = Math.min(maxPatchCharsPerFile, remainingChars - overhead);
    const { patch: truncated, truncated: wasTruncated, originalChars } = truncatePatch(patch, patchBudget);

    if (wasTruncated) {
      truncatedCount++;
    }

    remainingChars -= truncated.length + overhead;

    kept.push({
      filename: file.filename,
      status: file.status,
      patch: truncated,
      truncated: wasTruncated,
      originalChars,
    });
  }

  const totalChars = kept.reduce((sum, f) => sum + f.patch.length + f.filename.length, 0);

  return {
    files: kept,
    omitted,
    totalChars,
    truncatedCount,
    droppedCount: omitted.length,
  };
}