import { FileFilter } from '../src/modules/review/domain/fileFilter';
import { GitHubFile } from '../src/modules/github/domain/githubEntities';

describe('FileFilter', () => {
  let fileFilter: FileFilter;

  beforeEach(() => {
    fileFilter = new FileFilter();
  });

  describe('shouldIgnore', () => {
    it('should ignore binary files', () => {
      const binaryFile: GitHubFile = {
        filename: 'image.png',
        status: 'added',
        additions: 0,
        deletions: 0,
        contentsUrl: '',
      };
      expect(fileFilter.shouldIgnore(binaryFile)).toBe(true);
    });

    it('should ignore package-lock.json', () => {
      const lockFile: GitHubFile = {
        filename: 'package-lock.json',
        status: 'modified',
        additions: 10,
        deletions: 5,
        contentsUrl: '',
      };
      expect(fileFilter.shouldIgnore(lockFile)).toBe(true);
    });

    it('should ignore yarn.lock', () => {
      const lockFile: GitHubFile = {
        filename: 'yarn.lock',
        status: 'modified',
        additions: 100,
        deletions: 50,
        contentsUrl: '',
      };
      expect(fileFilter.shouldIgnore(lockFile)).toBe(true);
    });

    it('should ignore node_modules', () => {
      const modulesFile: GitHubFile = {
        filename: 'node_modules/some-package/index.js',
        status: 'added',
        additions: 50,
        deletions: 0,
        contentsUrl: '',
      };
      expect(fileFilter.shouldIgnore(modulesFile)).toBe(true);
    });

    it('should ignore dist folder', () => {
      const distFile: GitHubFile = {
        filename: 'dist/bundle.js',
        status: 'added',
        additions: 1000,
        deletions: 0,
        contentsUrl: '',
      };
      expect(fileFilter.shouldIgnore(distFile)).toBe(true);
    });

    it('should ignore deleted files', () => {
      const deletedFile: GitHubFile = {
        filename: 'src/index.ts',
        status: 'deleted',
        additions: 0,
        deletions: 50,
        contentsUrl: '',
      };
      expect(fileFilter.shouldIgnore(deletedFile)).toBe(true);
    });

    it('should NOT ignore source code files', () => {
      const sourceFile: GitHubFile = {
        filename: 'src/index.ts',
        status: 'modified',
        additions: 10,
        deletions: 5,
        contentsUrl: '',
      };
      expect(fileFilter.shouldIgnore(sourceFile)).toBe(false);
    });

    it('should ignore README files (by design)', () => {
      const readmeFile: GitHubFile = {
        filename: 'README.md',
        status: 'modified',
        additions: 5,
        deletions: 2,
        contentsUrl: '',
      };
      expect(fileFilter.shouldIgnore(readmeFile)).toBe(true);
    });
  });

  describe('filterFiles', () => {
    it('should filter out ignored files', () => {
      const files: GitHubFile[] = [
        { filename: 'src/index.ts', status: 'modified', additions: 10, deletions: 5, contentsUrl: '' },
        { filename: 'package-lock.json', status: 'modified', additions: 100, deletions: 50, contentsUrl: '' },
        { filename: 'src/utils.ts', status: 'added', additions: 20, deletions: 0, contentsUrl: '' },
        { filename: 'dist/bundle.js', status: 'added', additions: 500, deletions: 0, contentsUrl: '' },
      ];

      const filtered = fileFilter.filterFiles(files);

      expect(filtered.length).toBe(2);
      expect(filtered[0].filename).toBe('src/index.ts');
      expect(filtered[1].filename).toBe('src/utils.ts');
    });

    it('should return empty array when all files are ignored', () => {
      const files: GitHubFile[] = [
        { filename: 'package-lock.json', status: 'modified', additions: 100, deletions: 50, contentsUrl: '' },
        { filename: 'yarn.lock', status: 'modified', additions: 200, deletions: 100, contentsUrl: '' },
      ];

      const filtered = fileFilter.filterFiles(files);

      expect(filtered.length).toBe(0);
    });
  });
});
