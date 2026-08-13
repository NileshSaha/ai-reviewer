import {
  truncatePatch,
  fitToTokenBudget,
  DiffFileEntry,
  TruncatedDiffFile,
} from '../../src/modules/ai/application/diffTruncator';

describe('diffTruncator', () => {
  describe('truncatePatch', () => {
    it('returns patch unchanged when shorter than maxChars', () => {
      const result = truncatePatch('hello world', 100);
      expect(result.patch).toBe('hello world');
      expect(result.truncated).toBe(false);
      expect(result.originalChars).toBe(11);
    });

    it('returns empty patch for empty input', () => {
      const result = truncatePatch('', 100);
      expect(result.patch).toBe('');
      expect(result.truncated).toBe(false);
      expect(result.originalChars).toBe(0);
    });

    it('keeps head and tail with marker when patch is too large', () => {
      const long = 'A'.repeat(1000);
      const result = truncatePatch(long, 400);

      expect(result.truncated).toBe(true);
      expect(result.originalChars).toBe(1000);
      expect(result.patch.length).toBeLessThanOrEqual(450);
      expect(result.patch).toContain('[truncated');
      expect(result.patch.startsWith('AAA')).toBe(true);
      expect(result.patch.endsWith('AAA')).toBe(true);
    });

    it('includes the omitted character count in the marker', () => {
      const long = 'x'.repeat(500);
      const result = truncatePatch(long, 100);
      expect(result.patch).toMatch(/\[truncated \d+ chars\]/);
      expect(result.patch).toMatch(/\[truncated 4\d\d chars\]/);
    });
  });

  describe('fitToTokenBudget', () => {
    const makeFile = (overrides: Partial<DiffFileEntry>): DiffFileEntry => ({
      filename: 'src/file.ts',
      patch: 'diff content',
      status: 'modified',
      additions: 10,
      deletions: 5,
      ...overrides,
    });

    it('returns empty result for empty input', () => {
      const result = fitToTokenBudget([], { maxPromptChars: 1000, maxPatchCharsPerFile: 500 });
      expect(result.files).toHaveLength(0);
      expect(result.omitted).toHaveLength(0);
      expect(result.truncatedCount).toBe(0);
      expect(result.droppedCount).toBe(0);
    });

    it('keeps all files when total is well under budget', () => {
      const files = [
        makeFile({ filename: 'a.ts', patch: 'small patch', additions: 5, deletions: 2 }),
        makeFile({ filename: 'b.ts', patch: 'another small', additions: 8, deletions: 1 }),
      ];
      const result = fitToTokenBudget(files, { maxPromptChars: 5000, maxPatchCharsPerFile: 1500 });
      expect(result.files).toHaveLength(2);
      expect(result.omitted).toHaveLength(0);
      expect(result.droppedCount).toBe(0);
      expect(result.truncatedCount).toBe(0);
    });

    it('drops files when budget is exhausted', () => {
      const files = Array.from({ length: 10 }, (_, i) =>
        makeFile({ filename: `file${i}.ts`, patch: 'x'.repeat(800), additions: 100, deletions: 50 })
      );
      const result = fitToTokenBudget(files, { maxPromptChars: 3000, maxPatchCharsPerFile: 1500 });

      expect(result.files.length + result.omitted.length).toBe(10);
      expect(result.droppedCount).toBeGreaterThan(0);
      expect(result.totalChars).toBeLessThanOrEqual(3000);
    });

    it('prioritizes files with larger diffs (more additions+deletions)', () => {
      const files = [
        makeFile({ filename: 'tiny.ts', patch: 'x'.repeat(100), additions: 1, deletions: 0 }),
        makeFile({ filename: 'huge.ts', patch: 'y'.repeat(2000), additions: 500, deletions: 500 }),
        makeFile({ filename: 'medium.ts', patch: 'z'.repeat(800), additions: 50, deletions: 30 }),
      ];
      const result = fitToTokenBudget(files, { maxPromptChars: 5000, maxPatchCharsPerFile: 1500 });

      const keptNames = result.files.map((f: TruncatedDiffFile) => f.filename);
      expect(keptNames).toContain('huge.ts');
      expect(keptNames).toContain('medium.ts');
    });

    it('truncates files that exceed maxPatchCharsPerFile', () => {
      const big = 'a'.repeat(3000);
      const files = [makeFile({ filename: 'big.ts', patch: big, additions: 100, deletions: 100 })];
      const result = fitToTokenBudget(files, { maxPromptChars: 5000, maxPatchCharsPerFile: 500 });

      expect(result.files).toHaveLength(1);
      expect(result.files[0].truncated).toBe(true);
      expect(result.files[0].originalChars).toBe(3000);
      expect(result.files[0].patch.length).toBeLessThanOrEqual(600);
    });

    it('filters out deleted files', () => {
      const files = [
        makeFile({ filename: 'kept.ts', patch: 'content', status: 'modified' }),
        makeFile({ filename: 'gone.ts', patch: 'content', status: 'deleted' }),
      ];
      const result = fitToTokenBudget(files, { maxPromptChars: 5000, maxPatchCharsPerFile: 500 });
      const keptNames = result.files.map((f: TruncatedDiffFile) => f.filename);
      expect(keptNames).toContain('kept.ts');
      expect(keptNames).not.toContain('gone.ts');
    });

    it('filters out files with no patch', () => {
      const files = [
        makeFile({ filename: 'with-patch.ts', patch: 'content' }),
        makeFile({ filename: 'no-patch.ts', patch: null }),
      ];
      const result = fitToTokenBudget(files, { maxPromptChars: 5000, maxPatchCharsPerFile: 500 });
      const keptNames = result.files.map((f: TruncatedDiffFile) => f.filename);
      expect(keptNames).toContain('with-patch.ts');
      expect(keptNames).not.toContain('no-patch.ts');
    });

    it('respects reservedChars to leave room for system prompt + PR info', () => {
      const files = [makeFile({ filename: 'a.ts', patch: 'x'.repeat(1000), additions: 50, deletions: 50 })];
      const result = fitToTokenBudget(files, { maxPromptChars: 1500, maxPatchCharsPerFile: 500, reservedChars: 1400 });
      expect(result.files).toHaveLength(0);
      expect(result.omitted).toHaveLength(1);
    });
  });
});