import { GitHubFile } from '../../github/domain/githubEntities';

const IGNORED_PATTERNS = [
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
  /^Gemfile\.lock$/,
  /^Cargo\.lock$/,
  /^poetry\.lock$/,
  /^composer\.lock$/,
  /\.lock$/,
  /^dist\//,
  /^build\//,
  /^out\//,
  /^target\//,
  /^bin\//,
  /^obj\//,
  /^node_modules\//,
  /^bower_components\//,
  /^vendor\//,
  /^__pycache__\//,
  /\.pyc$/,
  /\.class$/,
  /\.o$/,
  /\.so$/,
  /\.dll$/,
  /\.exe$/,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.svg$/,
  /\.ico$/,
  /\.pdf$/,
  /\.zip$/,
  /\.tar$/,
  /\.gz$/,
  /\.rar$/,
  /\.7z$/,
  /\.woff$/,
  /\.woff2$/,
  /\.ttf$/,
  /\.eot$/,
  /\.otf$/,
  /\.map$/,
  /\.min\.(js|css)$/,
  /\.env$/,
  /\.env\..+/,
  /^\..+/,
  /^README/,
  /^CHANGELOG/,
  /^LICENSE/,
  /^CONTRIBUTING/,
  /^\.gitignore$/,
  /^tsconfig\.json$/,
  /^package\.json$/,
  /^jest\.config\.(js|ts)$/,
];

const BINARY_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
  '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.exe', '.dll', '.so', '.dylib',
  '.class', '.pyc', '.pyo',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv',
  '.xls', '.xlsx', '.doc', '.docx', '.ppt', '.pptx',
];

export class FileFilter {
  shouldIgnore(file: GitHubFile): boolean {
    if (this.isBinaryFile(file.filename)) {
      return true;
    }

    if (this.matchesIgnoredPattern(file.filename)) {
      return true;
    }

    if (file.status === 'deleted') {
      return true;
    }

    return false;
  }

  private isBinaryFile(filename: string): boolean {
    const ext = filename.toLowerCase().split('.').pop() || '';
    return BINARY_EXTENSIONS.includes(`.${ext}`);
  }

  private matchesIgnoredPattern(filename: string): boolean {
    return IGNORED_PATTERNS.some((pattern) => pattern.test(filename));
  }

  filterFiles(files: GitHubFile[]): GitHubFile[] {
    return files.filter((file) => !this.shouldIgnore(file));
  }
}
