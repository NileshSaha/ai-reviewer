import { PRDetails, DiffContent } from './aiTypes';
import { fitToTokenBudget, DiffFileEntry, FitResult } from './diffTruncator';

export interface BuildPromptOptions {
  maxPromptChars: number;
  maxPatchCharsPerFile: number;
  reservedChars?: number;
}

const DEFAULT_BUILD_OPTIONS: BuildPromptOptions = {
  maxPromptChars: 18000,
  maxPatchCharsPerFile: 1500,
  reservedChars: 1500,
};

export interface BuiltPrompt {
  prompt: string;
  fit: FitResult;
}

export function buildReviewPrompt(
  pr: PRDetails,
  diff: DiffContent,
  options: BuildPromptOptions = DEFAULT_BUILD_OPTIONS
): string {
  return buildReviewPromptDetailed(pr, diff, options).prompt;
}

export function buildReviewPromptDetailed(
  pr: PRDetails,
  diff: DiffContent,
  options: BuildPromptOptions = DEFAULT_BUILD_OPTIONS
): BuiltPrompt {
  const entries: DiffFileEntry[] = diff.files.map((f) => ({
    filename: f.filename,
    patch: f.patch,
    status: f.status,
  }));

  const fit = fitToTokenBudget(entries, {
    maxPromptChars: options.maxPromptChars,
    maxPatchCharsPerFile: options.maxPatchCharsPerFile,
    reservedChars: options.reservedChars,
  });

  const diffText = buildDiffText(fit);

  const prompt = `You are a senior software engineer doing a thorough code review. Analyze this pull request and make a definitive decision.

## Pull Request Information
- **Repository:** ${pr.repository}
- **PR Number:** ${pr.prNumber}
- **Title:** ${pr.title}
- **Description:** ${pr.body || 'No description provided'}
- **Author:** ${pr.author}
- **Base Branch:** ${pr.baseBranch}
- **Head Branch:** ${pr.headBranch}

## Code Changes (Diff)
${diffText}

## Decision Rubric (be strict, do not be polite)
- **90–100:** APPROVE — excellent code, only minor nitpicks
- **75–89:** APPROVE — solid, minor issues noted
- **60–74:** REQUEST_CHANGES — real issues that should be fixed before merge
- **0–59:** REQUEST_CHANGES — serious bugs, security flaws, or bad patterns

## Severity
- **critical:** Blocks merge (security, data loss, broken contract, SQL injection, XSS, secrets)
- **major:** Should fix before merge (bugs, performance, missing test coverage for critical paths)
- **minor:** Nice to fix (style, naming, micro-perf, readability)

## Output Requirements

Return ONLY valid JSON with no markdown wrapping. Use this exact structure:

{
  "verdict": "APPROVE or REQUEST_CHANGES",
  "score": 0..100,
  "summary": "2-3 sentence overall assessment",
  "strengths": ["what looks good"],
  "issues": [
    {
      "severity": "critical or major or minor",
      "file": "relative/path/to/file.ts",
      "line": 42,
      "description": "clear description of the issue",
      "suggestion": "specific suggestion for fixing the issue"
    }
  ],
  "security": "security concerns or null if none",
  "performance": "performance concerns or null if none",
  "comments": [
    {
      "file": "relative/path/to/file.ts",
      "line": 42,
      "text": "short, actionable inline comment for GitHub"
    }
  ],
  "overallComment": "see template below"
}

## overallComment Template

The overallComment field MUST be a well-formatted GitHub markdown comment using this exact structure:

## 🔍 Code Review Summary

### 📋 Overview
[2-3 sentence assessment]

### ✅ Strengths
- [strength 1]
- [strength 2]

### ⚠️ Issues Found

| Severity | File | Line | Issue | Suggestion |
|----------|------|------|-------|------------|
| 🔴 Critical | \`filename\` | 42 | description | suggestion |
| 🟡 Major | \`filename\` | 17 | description | suggestion |
| 🟢 Minor | \`filename\` | 88 | description | suggestion |

### 🔒 Security
[security notes or "No security concerns identified"]

### ⚡ Performance
[performance notes or "No performance concerns identified"]

### 📝 Verdict
[APPROVE: "This PR looks good to merge." / REQUEST_CHANGES: "Please address the issues above before merging."]

## Guidelines
- Include inline comments (in the "comments" field) only for significant issues. Skip style-only nits in inline comments.
- Be specific and actionable in every comment.
- If the PR is very small or trivial, reflect that in a higher score.
- If there are no security or performance concerns, set those fields to null (do not invent non-existent issues).`;

  return { prompt, fit };
}

function buildDiffText(fit: FitResult): string {
  if (fit.files.length === 0) {
    if (fit.droppedCount > 0) {
      return `[All ${fit.droppedCount} files were omitted due to prompt size limits]`;
    }
    return 'No files changed';
  }

  const sections = fit.files.map((f) => `### ${f.filename}\n\`\`\`diff\n${f.patch}\n\`\`\``);

  if (fit.omitted.length > 0) {
    const omittedList = fit.omitted.map((o) => o.filename).join(', ');
    sections.push(`\n[${fit.omitted.length} additional file(s) omitted to fit prompt budget: ${omittedList}]`);
  }

  if (fit.truncatedCount > 0) {
    sections.push(`\n[${fit.truncatedCount} file(s) were truncated; review focuses on the visible portions]`);
  }

  return sections.join('\n\n');
}