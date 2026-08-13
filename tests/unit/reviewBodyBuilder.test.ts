import { buildReviewBody, buildInlineComments } from '../../src/modules/review/application/reviewPipeline';
import { ScoringResult } from '../../src/modules/review/domain/scorer';
import { ReviewIssue } from '../../src/modules/ai/application/aiTypes';

function makeScoringResult(overrides: Partial<ScoringResult> = {}): ScoringResult {
  return {
    decision: 'APPROVE',
    score: 88,
    threshold: 80,
    aiVerdict: 'APPROVE',
    reason: 'Score meets threshold and AI approves.',
    ...overrides,
  };
}

function makeIssue(overrides: Partial<ReviewIssue> = {}): ReviewIssue {
  return {
    severity: 'minor',
    file: 'src/test.ts',
    description: 'Test description',
    ...overrides,
  };
}

describe('buildReviewBody', () => {
  it('generates APPROVE body with overallComment from AI', () => {
    const result = makeScoringResult({ decision: 'APPROVE', score: 92 });
    const body = buildReviewBody(result, {
      summary: 'Good code',
      strengths: ['Clean code', 'Good tests'],
      issues: [makeIssue({ severity: 'minor', description: 'Rename variable' })],
      security: null,
      performance: null,
      overallComment: 'Custom formatted comment from AI',
    }, 'groq');

    expect(body).toContain('## AI Based Code Review ✅');
    expect(body).toContain('**Score:** 92/100');
    expect(body).toContain('Custom formatted comment from AI');
    expect(body).toContain('AI Review powered by groq');
  });

  it('generates REQUEST_CHANGES body with overallComment from AI', () => {
    const result = makeScoringResult({ decision: 'REQUEST_CHANGES', score: 45 });
    const body = buildReviewBody(result, {
      summary: 'Needs fixing',
      strengths: [],
      issues: [makeIssue({ severity: 'critical', description: 'SQL injection risk' })],
      security: null,
      performance: null,
      overallComment: 'Please fix the security issue',
    }, 'groq');

    expect(body).toContain('## AI Based Code Review ❌');
    expect(body).toContain('Please fix the security issue');
  });

  it('builds body from fields when overallComment is empty', () => {
    const result = makeScoringResult({ decision: 'APPROVE', score: 85 });
    const body = buildReviewBody(result, {
      summary: 'Solid work',
      strengths: ['Well structured', 'Good error handling'],
      issues: [],
      security: null,
      performance: null,
      overallComment: '',
    }, 'openai');

    expect(body).toContain('## AI Based Code Review ✅');
    expect(body).toContain('### 📋 Overview');
    expect(body).toContain('Solid work');
    expect(body).toContain('### ✅ Strengths');
    expect(body).toContain('Well structured');
    expect(body).toContain('This PR looks good to merge');
    expect(body).not.toContain('⚠️');
  });

  it('includes issue table when there are issues', () => {
    const result = makeScoringResult({ decision: 'REQUEST_CHANGES', score: 55 });
    const body = buildReviewBody(result, {
      summary: 'Issues found',
      strengths: [],
      issues: [
        makeIssue({ severity: 'critical', file: 'src/auth.ts', description: 'Missing input validation' }),
        makeIssue({ severity: 'major', file: 'src/db.ts', line: 42, description: 'N+1 query' }),
      ],
      security: 'Hardcoded secret found',
      performance: 'Slow query in loop',
      overallComment: '',
    }, 'groq');

    expect(body).toContain('| 🔴 Critical | `src/auth.ts` |');
    expect(body).toContain('| 🟡 Major | `src/db.ts` | 42 |');
    expect(body).toContain('### 🔒 Security');
    expect(body).toContain('Hardcoded secret found');
    expect(body).toContain('### ⚡ Performance');
    expect(body).toContain('Slow query in loop');
    expect(body).toContain('Please address the issues above before merging');
  });

  it('shows privacy defaults for security and performance when issues exist but fields are null', () => {
    const result = makeScoringResult({ decision: 'REQUEST_CHANGES', score: 60 });
    const body = buildReviewBody(result, {
      summary: 'Issues found',
      strengths: [],
      issues: [makeIssue({ severity: 'major', description: 'Bug' })],
      security: null,
      performance: null,
      overallComment: '',
    }, 'groq');

    expect(body).toContain('No security concerns identified');
    expect(body).toContain('No performance concerns identified');
  });

  it('omits strengths section when strengths are empty', () => {
    const result = makeScoringResult({ decision: 'APPROVE', score: 82 });
    const body = buildReviewBody(result, {
      summary: 'OK',
      strengths: [],
      issues: [],
      security: null,
      performance: null,
      overallComment: '',
    }, 'groq');

    expect(body).not.toContain('✅ Strengths');
  });

  it('omits security/perf sections when no issues exist', () => {
    const result = makeScoringResult({ decision: 'APPROVE', score: 95 });
    const body = buildReviewBody(result, {
      summary: 'Perfect',
      strengths: ['Great'],
      issues: [],
      security: null,
      performance: null,
      overallComment: '',
    }, 'groq');

    expect(body).not.toContain('🔒');
    expect(body).not.toContain('⚡');
  });

  it('uses suggestion field in issue table', () => {
    const result = makeScoringResult({ decision: 'REQUEST_CHANGES', score: 50 });
    const body = buildReviewBody(result, {
      summary: 'Fix needed',
      strengths: [],
      issues: [makeIssue({ severity: 'major', description: 'Logic bug', suggestion: 'Add null check' })],
      security: null,
      performance: null,
      overallComment: '',
    }, 'groq');

    expect(body).toContain('Add null check');
  });
});

describe('buildInlineComments', () => {
  it('returns empty when decision is APPROVE', () => {
    const result = makeScoringResult({ decision: 'APPROVE' });
    const comments = buildInlineComments(result, [
      makeIssue({ severity: 'critical', file: 'src/a.ts', line: 10, description: 'Issue' }),
    ]);
    expect(comments).toHaveLength(0);
  });

  it('returns inline comments for issues with line numbers', () => {
    const result = makeScoringResult({ decision: 'REQUEST_CHANGES' });
    const comments = buildInlineComments(result, [
      makeIssue({ severity: 'critical', file: 'src/auth.ts', line: 42, description: 'Missing validation', suggestion: 'Add input check' }),
      makeIssue({ severity: 'minor', file: 'src/utils.ts', line: 17, description: 'Typo' }),
    ]);
    expect(comments).toHaveLength(2);
    expect(comments[0].path).toBe('src/auth.ts');
    expect(comments[0].line).toBe(42);
    expect(comments[0].body).toContain('[Critical]');
    expect(comments[0].body).toContain('Add input check');
    expect(comments[1].body).toContain('[Minor]');
    expect(comments[1].body).toContain('Typo');
  });

  it('filters out issues without line numbers', () => {
    const result = makeScoringResult({ decision: 'REQUEST_CHANGES' });
    const comments = buildInlineComments(result, [
      makeIssue({ severity: 'major', file: 'src/a.ts', line: 5, description: 'Bug' }),
      makeIssue({ severity: 'major', file: 'src/b.ts', description: 'No line' }), // no line
    ]);
    expect(comments).toHaveLength(1);
    expect(comments[0].path).toBe('src/a.ts');
  });

  it('formats severity emoji correctly', () => {
    const result = makeScoringResult({ decision: 'REQUEST_CHANGES' });
    const critical = buildInlineComments(result, [makeIssue({ severity: 'critical', file: 'a.ts', line: 1, description: 'X' })]);
    const major = buildInlineComments(result, [makeIssue({ severity: 'major', file: 'a.ts', line: 1, description: 'X' })]);
    const minor = buildInlineComments(result, [makeIssue({ severity: 'minor', file: 'a.ts', line: 1, description: 'X' })]);

    expect(critical[0].body).toContain('🔴');
    expect(major[0].body).toContain('🟡');
    expect(minor[0].body).toContain('🟢');
  });

  it('returns empty for empty issues array', () => {
    const result = makeScoringResult({ decision: 'REQUEST_CHANGES' });
    expect(buildInlineComments(result, [])).toHaveLength(0);
  });
});