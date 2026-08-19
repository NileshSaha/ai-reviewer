import {
  parseValidDiffLines,
  normalizeFilePath,
  buildValidDiffLinesMap,
  isLineInDiff,
} from '../../src/modules/review/domain/diffLineValidator';

describe('diffLineValidator', () => {
  describe('normalizeFilePath', () => {
    it('normalizes file paths with leading ./ and /', () => {
      expect(normalizeFilePath('./src/index.ts')).toBe('src/index.ts');
      expect(normalizeFilePath('/src/index.ts')).toBe('src/index.ts');
      expect(normalizeFilePath('.///src/index.ts')).toBe('src/index.ts');
      expect(normalizeFilePath('src/index.ts')).toBe('src/index.ts');
    });

    it('handles empty or whitespace strings', () => {
      expect(normalizeFilePath('')).toBe('');
      expect(normalizeFilePath('   ')).toBe('');
    });
  });

  describe('parseValidDiffLines', () => {
    it('returns empty set for null, undefined, or empty patch', () => {
      expect(parseValidDiffLines(null).size).toBe(0);
      expect(parseValidDiffLines(undefined).size).toBe(0);
      expect(parseValidDiffLines('').size).toBe(0);
    });

    it('correctly parses additions in a new file', () => {
      const patch = [
        '@@ -0,0 +1,3 @@',
        '+const a = 1;',
        '+const b = 2;',
        '+const c = 3;',
      ].join('\n');

      const lines = parseValidDiffLines(patch);
      expect(Array.from(lines)).toEqual([1, 2, 3]);
    });

    it('correctly parses modifications, context lines, and ignores deletions', () => {
      const patch = [
        '@@ -10,5 +20,6 @@ function test() {',
        '   const x = 1;',
        '-  const old = true;',
        '+  const updated = true;',
        '+  const extra = false;',
        '   return x;',
        ' }',
      ].join('\n');

      const lines = parseValidDiffLines(patch);
      // New start is 20:
      // Line 20: '   const x = 1;' (context)
      // Deleted line 'old': does not advance new line count
      // Line 21: '+  const updated = true;' (added)
      // Line 22: '+  const extra = false;' (added)
      // Line 23: '   return x;' (context)
      // Line 24: ' }' (context)
      expect(Array.from(lines)).toEqual([20, 21, 22, 23, 24]);
    });

    it('correctly parses multiple hunks in a single file patch', () => {
      const patch = [
        '@@ -5,3 +5,3 @@',
        '  line 5',
        '- line 6',
        '+ line 6 new',
        '  line 7',
        '@@ -50,2 +50,3 @@',
        '+ line 50 added',
        '  line 51',
        '  line 52',
      ].join('\n');

      const lines = parseValidDiffLines(patch);
      expect(Array.from(lines)).toEqual([5, 6, 7, 50, 51, 52]);
      expect(lines.has(8)).toBe(false);
      expect(lines.has(49)).toBe(false);
    });

    it('returns empty set for deleted files', () => {
      const patch = [
        '@@ -1,3 +0,0 @@',
        '-const a = 1;',
        '-const b = 2;',
        '-const c = 3;',
      ].join('\n');

      const lines = parseValidDiffLines(patch);
      expect(lines.size).toBe(0);
    });

    it('handles no newline at EOF marker', () => {
      const patch = [
        '@@ -1,2 +1,2 @@',
        '-const a = 1;',
        '+const a = 2;',
        '\\ No newline at end of file',
      ].join('\n');

      const lines = parseValidDiffLines(patch);
      expect(Array.from(lines)).toEqual([1]);
    });

    it('handles hunk headers without count (e.g. @@ -1 +1 @@)', () => {
      const patch = [
        '@@ -1 +1 @@',
        '+single line replacement',
      ].join('\n');

      const lines = parseValidDiffLines(patch);
      expect(Array.from(lines)).toEqual([1]);
    });
  });

  describe('buildValidDiffLinesMap', () => {
    it('builds a map of normalized filenames to valid line numbers', () => {
      const files = [
        {
          filename: 'src/a.ts',
          patch: '@@ -0,0 +1,2 @@\n+line1\n+line2',
        },
        {
          filename: './src/b.ts',
          patch: '@@ -10,2 +10,2 @@\n context\n+line11',
        },
        {
          filename: 'deleted.ts',
          patch: '@@ -1,2 +0,0 @@\n-line1\n-line2',
        },
      ];

      const map = buildValidDiffLinesMap(files);
      expect(map.get('src/a.ts')).toEqual(new Set([1, 2]));
      expect(map.get('src/b.ts')).toEqual(new Set([10, 11]));
      expect(map.get('deleted.ts')).toEqual(new Set());
    });
  });

  describe('isLineInDiff', () => {
    const map = new Map<string, Set<number>>([
      ['src/app.ts', new Set([10, 11, 12])],
    ]);

    it('returns true when line is in the diff hunk', () => {
      expect(isLineInDiff(map, 'src/app.ts', 11)).toBe(true);
      expect(isLineInDiff(map, './src/app.ts', 10)).toBe(true);
    });

    it('returns false when line is not in the diff hunk', () => {
      expect(isLineInDiff(map, 'src/app.ts', 150)).toBe(false);
      expect(isLineInDiff(map, 'src/other.ts', 10)).toBe(false);
      expect(isLineInDiff(map, 'src/app.ts', 0)).toBe(false);
      expect(isLineInDiff(map, 'src/app.ts', undefined)).toBe(false);
    });
  });
});
